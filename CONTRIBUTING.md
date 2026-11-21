# Contributing

Filament is open source so anyone can read it, check what it does and build on it. Here is how you can help.

## Report a bug or ask for something

Open an issue: [Bug report](https://github.com/invertibleMatrix/filament/issues/new?template=bug_report.yml) or
[Idea](https://github.com/invertibleMatrix/filament/issues/new?template=feature_request.yml). For a security problem,
please follow [SECURITY.md](SECURITY.md) instead.

## Code changes

A small fix can go straight to a pull request. For anything larger, open an issue first, so we agree on the approach
before you spend time on it. A pull request should pass `npm test` and `npm run typecheck`, and say what it changes
and why.

Filament is under the [Apache License 2.0](LICENSE): a contribution you send is under the same licence (its section 5).

## Build it yourself

Requires Node.js 22.13 or newer.

```bash
git clone https://github.com/invertibleMatrix/filament.git && cd filament
npm install
node bin/filament.js --open        # the console and the harness, in your browser
npm run desktop                    # the desktop app over the checkout
```

A Filament run from a checkout keeps its own data folder (`Filament-dev`, port 20301), apart from an installed one.
Builds you make yourself send no usage counts unless you turn them on.

To check the code: `npm test` runs the suite and `npm run typecheck` checks the types. The code is plain ES modules
with JSDoc types and no build step; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) maps every folder and file.

## Be decent

Everyone here follows the [code of conduct](CODE_OF_CONDUCT.md).
