## appoptics-apm changelog

### v6.0.0

Features and bug fixes
- route handling code and middleware for express, koa, and restify are now traced.
- use APPOPTICS_LOG_SETTINGS to set log levels; using the DEBUG environment variable is deprecated.
    - `export APPOPTICS_LOG_SETTINGS=error,warn` as opposed to `export DEBUG=appoptics:error,appoptics:warn`
- issue explicit log warning if disabled by config.
- fix koa-router probe to work with multiple middleware arguments.
- fix incorrect oboe library version reporting in init message.

Breaking changes
- all breaking changes are in the API. See `guides/migration-5to6.md` for details.
