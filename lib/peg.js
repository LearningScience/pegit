'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const cp = require('child_process');
const rl = require('readline');

/**
 * Exec Units
 */

const exec = (comm, pipe) => cp.execSync(comm, {
	shell: 'bash',
	input: pipe,
	stdio: ['pipe', 'pipe', 'pipe']
}).toString();

const xtty = (comm, pipe) => cp.spawnSync(comm, {
	shell: 'bash',
	input: pipe,
	stdio: ['pipe', 'inherit', 'pipe']
}).toString();

/**
 * Repo Units
 */

const zero = () => // => <revs>
	exec(`git hash-object -t tree /dev/null`)
	.replace(/[^0-9a-f]+/, '');

const root = () => // => <revs>
	exec(`git rev-list --max-parents=0 HEAD`)
	.replace(/[^0-9a-f]+/, '');

const gtop = () => // => <path>
	exec(`git rev-parse --show-toplevel`)
	.replace(/[\n]+/, '');

const udif = () => // => <n>
	+exec(`git rev-list --left-only --count @{u}...`)
	.replace(/[^\d]+/, '');

/**
 * Refs Units
 */

const listRefs = (glob) => globRefs(glob).map(refs => {
	let file = refsFile(refs);
	let date = refsDate(refs);
	let dirt = fileDirt(file);
	return {refs, file, date, dirt};
});

const globRefs = (glob) => // => [refs...]
	exec(`git for-each-ref **/${glob}* --format="%(refname)"`)
	.match(/\b([0-9a-f]{32})\b/g) || [];

const refsFile = (refs) => // => <file>
	exec(`git for-each-ref **/${refs} --format="%(subject)"`)
	.replace(/\b(.*)\n+/, '$1') + '/' +
	exec(`git for-each-ref **/${refs} --format="%(body)"`)
	.replace(/\b(.*)\n+/, '$1');

const refsDate = (refs) => // => <date>
	+exec(`git for-each-ref **/${refs} --format="%(taggerdate:raw)"`)
	.replace(/^(\d+).*\n/, '$1');

/**
 * File Units
 */

const listFile = (glob) => globFile(glob).map(file => {
	let refs = fileRefs(file);
	let date = refsDate(refs);
	let dirt = fileDirt(file);
	return {refs, file, date, dirt};
});

const globFile = (glob) => // => [file...]
	exec(`git ls-files ${glob} --full-name`)
	.match(new RegExp(cfg.file, 'g')) || [];

const fileRefs = (file) => // => <refs>
	exec(`git hash-object --stdin`, path.dirname(file))
	.replace(/\b([0-9a-f]{16}).*\n/, '$1') + '' +
	exec(`git rev-parse HEAD:${path.dirname(file)}`)
	.replace(/\b([0-9a-f]{16}).*\n/, '$1');

const fileDirt = (file) => // => <dirt>
	+exec(`git status ${path.dirname(file)} --porcelain`)
	.replace(/[^\n]+/g, '').length;

/**
 * Plumbing
 */

const list = (glob) => {
	let fglob = glob.join(' ');
	let file = listFile(fglob).map((file) => {
		let rglob = file.refs.substr(0, 16);
		let refs = listRefs(rglob).sort((a, b) => {
			return b.date - a.date;
		});
		return [file, ...refs];
	});
	let every = file;
	let dirty = [], clean = [], exist = [];
	for (let x of every) {
		if (x[0].dirt) {
			dirty.push(x);
		} else
		if (!x[0].date) {
			clean.push(x);
		} else
		if (x[0].date) {
			exist.push(x);
		}
	}
	return {dirty, clean, exist, every};
};

const pull = () => {
	let log, err;
	try {
		log = exec(`git fetch --tags 2>&1`);
		log = new Set(log.match(/\b([0-9a-f]{32})\b(?=)/g));
	} catch (e) {
		err = e;
	}
	if (err) {
		console.log(err.message);
		process.exit(1);
	}
	return log;
};

const push = (l, opts = {}) => {
	let log, err;
	if (l.length) for (let x of l) {
		let y = x[0];
		let tree = path.dirname(y.file);
		let main = path.basename(y.file);
		y.mess = `'${tree}\n\n${main}'`;
		exec(`git tag -a ${y.refs} -m ${y.mess}`);
		x.unshift(y);
	}
	try {
		let up = exec(`git rev-parse --abbrev-ref @{u}`).match(/\w+/g);
		log = exec(`git push --porcelain ${up[0]} ${up[1]} --tags`);
		log = new Set(log.match(/\b([0-9a-f]{32})\b(?=\t\[new tag\])/g));
	} catch (e) {
		err = e;
	}
	if (err) for (let x of l) {
		let y = x[0];
		let tree = path.dirname(y.file);
		let main = path.basename(y.file);
		y.mess = `'${tree}\n\n${main}'`;
		exec(`git tag -d ${y.refs}`);
		x.shift(y);
	}
	if (err) {
		console.log(err.message);
		process.exit(1);
	}
	return log;
};

const sync = (l, opts = {}) => {
	let log, err;
	let temp = `${os.tmpdir()}/peg-deploy`;
	exec(`rm -rf ${temp}`);
	for (let x of l) {
		x.shift();
		for (let y of x) {
			let refs = y.refs;
			let tree = path.dirname(y.file);
			let main = path.basename(y.file);
			if (refs) {
				exec(`mkdir -p '${temp}/${tree}'`);
				exec(`cat >> '${temp}/${tree}/deploy'`, `${refs}/${main}\n`);
			}
			if (y === x[0] || opts.full) {
				exec(`mkdir -p '${temp}/${tree}/${refs}'`);
				exec(`git archive ${refs}:${tree} | tar -x -C '${temp}/${tree}/${refs}'`);
			}
		}
	}
	try {
		log = exec(`rsync --info=none,name1 -r ${temp}/ ${cfg.host}`);
		log = new Set(log.match(/\b([0-9a-f]{32})\b(?=)/g));
		opts.arch && exec(`cd ${temp}; zip -r $OLDPWD/deploy.zip ./*`);
	} catch (e) {
		err = e;
	}
	if (err) {
		console.log(err.message);
		process.exit(1);
	}
	return log;
};

const config = (cfg) => {
	const keys = Object.keys(cfg);
	const read = rl.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	const loop = (i) => {
		if (keys[i]) {
			let name = cfg[keys[i]].name;
			let test = cfg[keys[i]].test;
			let err;
			read.question(`\n${name}: `, data => {
				process.stdout.write('  Testing... ');
				try {
					data = test(data);
				} catch (e) {
					err = e;
				}
				if (err) {
					console.log(err.message);
					cfg[keys[i]] = cfg[keys[i]];
					loop(i + 0);
				} else {
					console.log('OK');
					cfg[keys[i]] = data;
					loop(i + 1);
				}
			});
		} else {
			read.close();
			cfg = JSON.stringify(cfg, null, '\t');
			fs.writeFileSync(`${gtop()}/.pegit.json`, cfg);
		}
	};
	loop(0);
};

/**
 * Interface
 */

const confirm = (y, n) => {
	const read = rl.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	read.question('Are you sure? ', data => {
		if (/^yes/i.test(data)) {
			read.close();
			y && y();
		} else
		if (/^no?/i.test(data)) {
			read.close();
			n && n();
		} else {
			process.stdout.write('Type "yes" or "no": ');
		}
	});
};

const pretty = {
	oneline: `\
\x1b[34m%(tag) \x1b[0m%(subject)`,
	short: `\
\x1b[34mtag %(tag) \x1b[0m
Tagger: %(taggername) %(taggeremail)
\n    %(subject) -- %(body)`,
	medium: `\
\x1b[34mtag %(tag) \x1b[0m
Tagger: %(taggername) %(taggeremail)
Date:   %(taggerdate)
\n    %(subject) -- %(body)`,
	full: `\
\x1b[34mtag %(tag) \x1b[0m
Tagger: %(taggername) %(taggeremail)
Date:   %(taggerdate)
\n    %(subject) -- %(body)`
};

/**
 * Porcelain
 */

exports.status = (glob, opts) => {
	exports.pull(glob, opts);
	let l = list(glob);
	console.log(``);
	if (l.exist.length) {
		console.log(`Current deployments:
  (trees unchanged since deployment)
  (use "peg log <pathspec>..." to explore history)\n`);
		for (let x of l.exist) {
			let stat = x.length > 2 ? 'deployed' : 'new tree';
			let tree = path.dirname(x[0].file);
			console.log(`\t\x1b[34m${stat}: ${tree}\x1b[0m`);
		}
		console.log(``);
	}
	if (l.clean.length) {
		console.log(`Ready for deployment:
  (clean trees with undeployed changes)
  (use "peg deploy <pathspec>..." to create deploys)\n`);
		for (let x of l.clean) {
			let stat = x.length > 1 ? 'modified' : 'new tree';
			let tree = path.dirname(x[0].file);
			console.log(`\t\x1b[32m${stat}: ${tree}\x1b[0m`);
		}
		console.log(``);
	}
	if (l.dirty.length) {
		console.log(`Unfit for deployment:
  (dirty trees with uncommitted changes)
  (use "git commit <pathspec>..." to create commits)\n`);
		for (let x of l.dirty) {
			let stat = x.length > 1 ? 'modified' : 'new tree';
			let tree = path.dirname(x[0].file);
			console.log(`\t\x1b[31m${stat}: ${tree}\x1b[0m`);
		}
		console.log(``);
	}
	if (udif()) {
		console.log(`Behind upstream by ${udif()} commits.
  (unable to deploy out of date content)
  (use "git pull" to update your local branch)\n`);
	}
};

exports.show = (glob, opts) => {
	exports.pull(glob, opts);
	let l = list(glob);
	let text = '';
	for (let x of l.every) {
		let a = x[2] ? x[2].refs : zero() ;
		let b = x[1] ? x[1].refs : zero() ;
		let tree = path.dirname(x[0].file);
		text += exec(`git diff ${a}..${b} ${tree}`);
	}
	xtty(`less -RFX`, text);
};

exports.diff = (glob, opts) => {
	exports.pull(glob, opts);
	let l = list(glob);
	let text = '';
	for (let x of l.every) {
		let a = x[1] ? x[1].refs : zero() ;
		let tree = path.dirname(x[0].file);
		text += exec(`git diff ${a} ${tree}`);
	}
	xtty(`less -RFX`, text);
};

exports.log = (glob, opts) => {
	exports.pull(glob, opts);
	glob = glob.join(' ');
	let refs = globFile(glob).map(file => `**/${fileRefs(file).substr(0, 16)}*`);
	refs = refs.join(' ');
	let text = '';
	if (refs.length) {
		let format = pretty[opts.pretty] || opts.pretty;
		text += exec(`git for-each-ref ${refs} --sort=-taggerdate --format="${format}"`);
	}
	xtty(`less -RFX`, text);
};

exports.deploy = (glob, opts) => {
	exports.pull(glob, opts);
	let l = list(glob).clean;
	console.log(``);
	if (!glob.length) {
		return console.log(`Implicit paths are disallowed on deploy.
  (use "." to deploy current working directory)
  (or provide a pathspec with greater specificity)\n`);
	}
	if (udif()) {
		return console.log(`Behind upstream by ${udif()} commits.
  (unable to deploy out of date content)
  (use "git pull" to update your local branch)\n`);
	}
	if (l.length) {
		console.log(`The following trees will be deployed:`);
		for (let x of l) {
			let tree = path.dirname(x[0].file);
			console.log(`\x1b[32m + ${tree}\x1b[0m`);
		}
		confirm(() => {
			exports.push(glob, opts, l);
			exports.sync(glob, opts, l);
		});
	} else {
		console.log(`Nothing to deploy`);
	}
};

exports.pull = (glob, opts, l) => {
	if (opts.fast) {return};
	opts.fast = true;
	console.log(`Pulling tags...`);
	let tags = pull(l, opts);
	if (tags.size) {
		for (let refs of tags) {
			let tree = path.dirname(refsFile(refs));
			console.log(` + \x1b[34m${refs}\x1b[0m -> ${tree}`);
		}
	} else {
		console.log(`Tags up-to-date`);
	}
};

exports.push = (glob, opts, l) => {
	exports.pull(glob, opts);
	l = l || list(glob).every;
	console.log(`Pushing tags...`);
	let tags = push(l, opts);
	if (tags.size) {
		for (let refs of tags) {
			let tree = path.dirname(refsFile(refs));
			console.log(` + \x1b[34m${refs}\x1b[0m -> ${tree}`);
		}
	} else {
		console.log(`Tags up-to-date`);
	}
};

exports.sync = (glob, opts, l) => {
	exports.pull(glob, opts);
	l = l || list(glob).every;
	console.log(`Syncing tree...`);
	let tree = sync(l, opts);
	if (tree.size) {
		for (let refs of tree) {
			let tree = path.dirname(refsFile(refs));
			console.log(` + ${tree} -> \x1b[34m${refs}\x1b[0m`);
		}
	} else {
		console.log(`Tree up-to-date`);
	}
};

exports.config = () => config({
	host: {
		name: 'Content Server',
		test: data => {
			exec(`rsync ${data}`);
			return data;
		}
	},
	file: {
		name: 'Entry Pattern',
		test: data => {
			new RegExp(data, 'g');
			return data;
		}
	}
});

/**
 * Initialise
 */

let cfg;

try {
	if (process.argv[2] !== undefined) {
		exec(`git rev-parse`);
	}
} catch (e) {
	console.log(`Fatal: Not a git repository.
  (Pegit only works inside git repositories)
  (Try "git init" to create a new repo here)`);
	process.exit(1);
}

try {
	if (process.argv[2] !== undefined) {
		exec(`git rev-parse @{u}`);
	}
} catch (e) {
	console.log(`Fatal: Not tracking a remote.
  (Tracking is required to share deploy tags)
  (Try "git push -u" to track remote branch)`);
	process.exit(1);
}

try {
	if (process.argv[2] !== 'config') {
		cfg = require(`${gtop()}/.pegit.json`);
	}
} catch (e) {
	console.log(`Fatal: No pegit config found.
  (A pegit config is required for each repo)
  (Use "peg config" to create a .pegit file)`);
	process.exit(1);
}
