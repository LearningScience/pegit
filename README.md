# Pegit

>  The stupid content deployer

Pegit is a lightweight content deployment tool based on git tags. It revisions and deploys sub-trees of a git repo independently of each other with content addressed tag names. A permanent path for every revision of each sub-tree is provided by the generated output along with a revision index file.

This is useful when differences between content revisions are likely to break user state. In such a system it's desirable to lock sessions to the revision they start with (with permanent revision paths), while allowing new sessions to dynamically obtain the latest revision (with revision index files).

- All functionality is provided by one git-like CLI tool
- All deployment information is stored in git tags
- Simple static output, no stupidly complex backends
- Permanent paths to every revision of each tree

## Install

Install pegit globally to provide the `peg` command:

```sh
npm install -g pegit
```

`peg` is an easy to use git-like interface which allows you to create, upload, review and regenerate deployments from within any repo. It works with multiple users through a git remote. It is the only tool you will need as a content author and is thoroughly documented by it's man page `man peg`.

## Config

A `.pegit` config must be created for each git repo:

```sh
peg config
```

The "entry pattern" is a regex to identify entry-points and content-trees e.g `.*\/index\.html` and the "content server" is an SSH address to upload content e.g `user@host.com:/path`. Due to rsync permission issues, you should share a single user account, and add an ssh-key for each author.

## Deploying Content

Content can be anything with an identifiable entry-point, but we will stick with static web content as an example and target `index-*.html` file names as entry-points. By configuring the entry-pattern `.*\/index[-\w]*\.html` pegit will be able to identify and deploy trees in the following example:

```console
$ tree
.
├── a/b/c
│       ├── index-foo.html
│       └── script.js
└── x/y/z
        ├── index-bar.html
        └── script.js
```

#### peg-status

Peg-status checks for differences between deployed, committed and uncommitted trees, just like git-status checks for differences between committed, staged and unstaged files. Think of "committed" as the equivalent of "staged" for pegit deployments, these are listed under the "ready" section.

```console
$ peg status

Ready for deployment:
  (clean trees with undeployed changes)
  (use "peg deploy <pathspec>..." to create deploys)

	new tree: a/b/c
	new tree: x/y/z
```

#### peg-deploy

Peg-deploy will attempt to deploy each "ready" tree, this can be filtered with an optional pathspec if only a subset of "ready" trees are desired. New deploy tags are created for the selected trees, pushed to the git remote to share with collaborators and the trees are synced to the content-server.

```console
$ peg deploy .

The following trees will be deployed:
 + a/b/c
 + x/y/z
Are you sure? yes
Pushing tags...
 + ccbaf232c6c05c41af0532b1df3a0e9b -> a/b/c
 + dcb207f67fe27f4cac909bc967e38eb2 -> x/y/z
Syncing tree...
 + a/b/c -> ccbaf232c6c05c41af0532b1df3a0e9b
 + x/y/z -> dcb207f67fe27f4cac909bc967e38eb2
```

#### peg-log

Peg-log is like git-log for deploy-tags with tagger information, more or less info can be shown using the --pretty formatting option. The messages shown are not user defined but have been automatically added by pegit and are used for  obtaining the git tree-object and building the revision index.

```console
$ peg log

tag dcb207f67fe27f4cac909bc967e38eb2
Tagger: John Smith <john@smith.com>
Date:   Mon Jan 1 00:00:00 2018 +0000

    x/y/z -- index-bar.html

tag ccbaf232c6c05c41af0532b1df3a0e9b
Tagger: John Smith <john@smith.com>
Date:   Mon Jan 1 00:00:00 2018 +0000

    a/b/c -- index-foo.html
```

#### Updates

Now lets deploy some small updates. This will be helpful in understanding the output that's uploaded to the content-server later. For each tree-path, if the committed tree-object differs from the currently deployed tree-object in any way, it will be listed as deployable with "ready" status:

```console
$ echo "lah" >> a/b/c/script.js
$ mv x/y/z/index-bar.html x/y/z/index-lah.html
$ git add -A
$ git commit -m "WIP"
$ peg deploy .

The following trees will be deployed:
 + a/b/c
 + x/y/z
Are you sure? yes
Pushing tags...
 + ccbaf232c6c05c418f992f651877353d -> a/b/c
 + dcb207f67fe27f4cadc6d917527346bc -> x/y/z
Syncing tree...
 + a/b/c -> ccbaf232c6c05c418f992f651877353d
 + x/y/z -> dcb207f67fe27f4cadc6d917527346bc
```

#### peg-sync

What happens if your content-server blows up!? Your git repo doubles as your backup. Peg-sync can regenerate all deploy content from deploy tags alone. This is usually called as the final stage of peg-deploy, but it is useful to call explicitly to verify or rebuild a content-server from scratch.

```console
$ peg sync --full

Syncing tree...
 + a/b/c -> ccbaf232c6c05c418f992f651877353d
 + a/b/c -> ccbaf232c6c05c41af0532b1df3a0e9b
 + x/y/z -> dcb207f67fe27f4cac909bc967e38eb2
 + x/y/z -> dcb207f67fe27f4cadc6d917527346bc
```

## Consuming Content

There is no back-end for pegit because the output is simple, static and can be consumed directly. Even front-end code in a browser can consume the output without extra server-side code in-between. Following on from the example in the previous section, take a look at the state of the content server:

```console
$ tree
.
├── a/b/c
│       ├── ccbaf232c6c05c418f992f651877353d
│       │   ├── index-foo.html
│       │   └── script.js
│       ├── ccbaf232c6c05c41af0532b1df3a0e9b
│       │   ├── index-foo.html
│       │   └── script.js
│       └── deploy
└── x/y/z
        ├── dcb207f67fe27f4cac909bc967e38eb2
        │   ├── index-bar.html
        │   └── script.js
        ├── dcb207f67fe27f4cadc6d917527346bc
        │   ├── index-lah.html
        │   └── script.js
        └── deploy
```

The root of each tree has been replaced with a collection of directories, one for each revision. There are also some mysterious `deploy` files that were not part of the original content. These are revision indices, they allow revision paths to be dynamically retrieved. Let's take a look at one:

```console
$ cat x/y/z/deploy
dcb207f67fe27f4cadc6d917527346bc/index-lah.html
dcb207f67fe27f4cac909bc967e38eb2/index-bar.html
```

It contains a simple list of relative paths to the entry-file of each revision directory, they are sorted in descending chronological order (latest at the top). All absolute revision paths can be obtained from this file alone. As you can imagine parsing it is going to be a piece of cake.

#### Getting Revisions Dynamically

As an example, if the content-server is also a web-server, we can write a bit of front-end code to retrieve one of the deploy files and process it to obtain some explicit revision paths. Two bits of information are required, the content server address and a content tree path e.g `x/y/z`:

```js
const getRevs = (root, path, cb) => {
	// Get deploy file
	$.ajax({
		method: 'GET',
		url: `${root}/${path}/deploy`,
		cache: false
	})
	// Parse deploy file
	.done(revs => {
		revs = revs.split(/\n/);
		revs = revs.map(x => `${root}/${path}/${x}`);
		cb(revs);
	});
};

const root = 'host.com/path';
const path = 'x/y/z';

getRevs(root, path, revs => {
	let latest = revs[0];
});
```

This doesn't seem particularly useful on it's own, if you only cared about the latest revision you could rightly argue that `x/y/z` could have been replaced with the latest revision. The usefulness comes with the permanence of the explicit revision paths and association with user-sessions...

#### Using Revisions Permanently

The whole purpose of this process is to obtain a permanent revision path that can be associated with a user-session without preventing new sessions from obtaining later revisions. At this point we need some (separate) server side session storage or local storage to maintain user state:

```js
const save = (cb) => {
	// Save state to server
};
const load = (cb) => {
	// Load state from server
};
const ready = (state) => {
	// Do stuff
};

load(state => {
	// New session
	if (typeof state.rev === 'undefined') {
		getRevs(root, path, revs => {
			state.rev = revs[0];
			save();
			ready(state);
		});
	} else
	// Old session
	if (typeof state.rev === 'string') {
		ready(state);
	}
});
```

This is the use-case Pegit was designed for: associating revision sensitive user-state with specific content-revisions, without a complex server-side solution. There may be other uses but keep in mind that a full copy of each revision is intentionally being stored on the content server.

## Contribute

Suggestions and contributions will be considered. When crafting a pull request please consider if your contribution is a good fit with the project, follow contribution best practices and use the github "flow" workflow.

## License

[The MIT License](LICENSE.md)
