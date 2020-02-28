# Contributing to AppOptics development

## Certificate of origin

Ours is the same as node's:

By making a contribution to this project, I certify that:

a) The contribution was created in whole or in part by me and I have the right to submit it under the open source license indicated in the file; or

b) The contribution is based upon previous work that, to the best of my knowledge, is covered under an appropriate open source license and I have the right under that license to submit that work with modifications, whether created in whole or in part by me, under the same open source license (unless I am permitted to submit under a different license), as indicated in the file; or

c) The contribution was provided directly to me by some other person who certified (a), (b) or (c) and I have not modified it.

d) I understand and agree that this project and the contribution are public and that a record of the contribution (including all personal information I submit with it, including my sign-off) is maintained indefinitely and may be redistributed consistent with this project or the open source license(s) involved.

## Resources

* An [overview](https://github.com/appoptics/appoptics-apm-node/blob/master/guides/instrumenting-a-module.md)
on using the API to instrument a module.

* The [complete API reference](https://github.com/appoptics/appoptics-apm-node/blob/master/guides/api.md).

* The [AppOptics Knowledge Base](https://docs.appoptics.com) has
a large collection of technical articles.

* you can submit a support request directly to the team.

If you have any questions or ideas, don't hesitate to contact us anytime.

## Layout of the module

The oboe module uses a standard layout.  Here are the notable directories.

```
lib/                # core modules
lib/probes          # auto loaded instrumentation
test/               # mocha test suite
test/probes/        # tests for probes
```

## Testing

mocha and tap are installed globally; they are not devDependencies of the agent. If
you don't have them installed globally then you'll need to add them as devDepencies.

Under the `test` directory all test files end with either `.test.js` (`mocha`) or
`.tap.js` (`tap`). Other files are support files for testing and should not be directly
executed by `mocha` or `tap`.

Testing the probes requires that `docker-compose up -d` has been executed to
start back-end services. You can use `env.sh` enables setting up the environment
for testing by sourcing it like `. env.sh bash`. It provides a little bit of
documentation of various setups that can be used.

## Compiling the C extension

This module utilizes a C++ node extension to interface with the `liboboe.so`
library.  `liboboe` is installed as part of the `appoptics-bindings` package
which is a dependency of this package.  It is used to report host and
performance metrics to AppOptics servers.

If you would like to work with the C++ extension, clone the github
`appoptics/appoptics-bindings-node` repository and work with that.
