// @ts-check
// What a command Filament runs sees of the environment Filament was started with (r-hands, 11-12; adapters/tools/
// hands.js `safeEnv`). A list of names lets through what a build, a test or git needs and that is no secret: proxies,
// certificate bundles, the ssh agent's socket, git's author, the toolchains' homes. What the list does not know, the
// person names in `agentLoop.envPass`, names only. A secret stays out: a name of a family (`GIT_*`, `npm_config_*`)
// that reads like one, an address with a password in it, git's config by environment, Filament's own variables, and
// whatever nobody named. Until then the list was a shell's bare needs, and "auth" among the secret-shaped words took
// git's author with the tokens: an `npm install` behind a proxy, or a commit with its author set, passed in a coding
// agent's own shell and failed in Filament's.
// No assertion here prints a variable's value: names are compared, and a value only by whether it came through.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { ENV_WORDS, HAND_TOOLS, bashDescription, powershellDescription, runHand, safeEnv } from "../src/adapters/tools/hands.js";
import { MCP_TOOLS } from "../src/http/mcp.js";
import { BACKGROUND_COMMAND_MACHINE_TOOL, BACKGROUND_COMMAND_TOOL } from "../src/app/agent/commands.js";
import { CONFIG_SCHEMA } from "../src/core/schema.js";
import { defaultConfig } from "../src/config.js";
import { validateConfig } from "../src/services/config/store.js";
import { startApp } from "./helpers/app.js";

/** What the list lets through by itself, a family a line. */
const FAMILIES = {
  "Windows' folders": "ProgramW6432 CommonProgramFiles(x86) CommonProgramW6432",
  proxies: "HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy",
  "certificate bundles": "NODE_EXTRA_CA_CERTS SSL_CERT_FILE SSL_CERT_DIR REQUESTS_CA_BUNDLE CURL_CA_BUNDLE AWS_CA_BUNDLE",
  "the ssh agent": "SSH_AUTH_SOCK SSH_AGENT_PID",
  "git's author and committer": "GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE",
  "who and where": "USER LOGNAME USERNAME USERDOMAIN HOSTNAME COMPUTERNAME OS DISPLAY WAYLAND_DISPLAY XAUTHORITY XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_RUNTIME_DIR COLORTERM NO_COLOR FORCE_COLOR CI EDITOR VISUAL PAGER",
  "Android and .NET": "ANDROID_HOME ANDROID_SDK_ROOT ANDROID_NDK_HOME ANDROID_NDK_ROOT DOTNET_ROOT DOTNET_CLI_HOME MSBUILD_EXE_PATH NUGET_PACKAGES",
  "C, C++ and the game SDKs": "VCPKG_ROOT VCPKG_DEFAULT_TRIPLET VULKAN_SDK EMSDK QTDIR CMAKE_PREFIX_PATH CMAKE_GENERATOR CMAKE_TOOLCHAIN_FILE PKG_CONFIG_PATH LD_LIBRARY_PATH DYLD_LIBRARY_PATH LIBRARY_PATH CPATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH CC CXX CFLAGS CXXFLAGS CPPFLAGS LDFLAGS",
  "Visual Studio's prompt and Xcode": "VSINSTALLDIR VCINSTALLDIR VCToolsInstallDir VCToolsVersion VisualStudioVersion WindowsSdkDir WindowsSDKVersion UniversalCRTSdkDir UCRTVersion VSCMD_ARG_TGT_ARCH VSCMD_ARG_HOST_ARCH INCLUDE LIB LIBPATH SDKROOT DEVELOPER_DIR",
  "the JVM, Flutter and Ruby": "GRADLE_HOME GRADLE_USER_HOME MAVEN_HOME M2_HOME ANT_HOME FLUTTER_ROOT PUB_CACHE PUB_HOSTED_URL FLUTTER_STORAGE_BASE_URL GEM_HOME GEM_PATH RBENV_ROOT",
  Python: "VIRTUAL_ENV CONDA_PREFIX CONDA_DEFAULT_ENV PYENV_ROOT PIPX_HOME POETRY_HOME PYTHONUTF8 PYTHONIOENCODING",
  Node: "NODE_ENV NVM_DIR NVM_HOME NVM_SYMLINK FNM_DIR VOLTA_HOME PNPM_HOME BUN_INSTALL DENO_DIR DENO_INSTALL COREPACK_HOME",
  "Go and Rust": "GOBIN GOCACHE GOMODCACHE GOFLAGS CGO_ENABLED GOOS GOARCH GOPROXY GOPRIVATE GONOPROXY GONOSUMDB GOSUMDB CARGO_TARGET_DIR RUSTUP_TOOLCHAIN RUSTFLAGS RUSTC_WRAPPER",
  "which credentials on disk": "AWS_PROFILE AWS_REGION AWS_DEFAULT_REGION AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE KUBECONFIG DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG DOCKER_TLS_VERIFY DOCKER_CERT_PATH",
};
/** Names nothing lets through: a key, a token, a cloud's credentials, a family's name that reads like a secret, and one nobody knows. */
const SECRETS = "ANTHROPIC_API_KEY OPENAI_API_KEY GITHUB_TOKEN GH_TOKEN NPM_TOKEN AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN npm_config__authToken npm_config_//registry.npmjs.org/:_authToken GIT_SHIMTEST_TOKEN GIT_SHIMTEST_PASSWORD DATABASE_URL SHIMTEST_LICENCE".split(" ");

/** An environment of these names, each with a plain value. @param {readonly string[]} names @param {string} [value] */
const envOf = (names, value = "plain") => Object.fromEntries(names.map((n) => [n, value]));
/** The names that came through, in order. @param {Record<string, string | undefined>} out */
const names = (out) => Object.keys(out).sort();
/** `fn` run with these variables in the process's own environment, which gets its own back. @template T @param {Record<string, string>} vars @param {() => T | Promise<T>} fn */
const withEnv = async (vars, fn) => {
  const was = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};
/**
 * Which of `wanted` are among `have`, the names of a real environment: on Windows a name is the same name in any case,
 * and one this machine sets already keeps the case it had.
 * @param {readonly string[]} wanted @param {Iterable<string>} have
 */
const among = (wanted, have) => {
  const fold = (/** @type {string} */ k) => (process.platform === "win32" ? k.toUpperCase() : k);
  const set = new Set([...have].map(fold));
  return wanted.filter((k) => set.has(fold(k)));
};
/** A command that prints the names of its own environment and no value, read alike by Git Bash, cmd.exe and sh. */
const PRINT_NAMES = `node -e "console.log(Object.keys(process.env).join(' '))"`;
/** The names a real command of the bash hand saw. */
const namesSeen = async () => String(await runHand("bash", { command: PRINT_NAMES }, { root: tmpdir() })).trim().split(/\s+/);
/** A proxy's address with a password in it. */
const WITH_PASSWORD = "http://shimtest:hunter2@proxy.test:8080";

describe("what the list lets through", () => {
  // (fails before: yes — of these 150 names the rule let 3 through, git's committer by the `GIT_*` pattern: no proxy, no
  // certificate bundle, no ssh agent, no author, no SDK's home. `safeEnv` took no environment then: handed one, it
  // answered Filament's own, so every test here that hands it one failed with it)
  for (const [family, list] of Object.entries(FAMILIES))
    test(`${family}: each name passes, on Windows and elsewhere`, () => {
      const all = list.split(" ");
      for (const platform of ["win32", "linux"]) assert.deepEqual(names(safeEnv({ env: envOf(all), pass: [], platform })), [...all].sort(), platform);
    });

  // (fails before: yes — `safeEnv()` gave none of the four)
  test("Filament's own environment is read where none is handed in: a proxy, a bundle, the agent's socket and git's author reach a command", async () => {
    const vars = { HTTPS_PROXY: "http://proxy.test:8080", NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem", SSH_AUTH_SOCK: "/tmp/agent.sock", GIT_AUTHOR_NAME: "Shim Test", SHIMTEST_API_KEY: "sk-shimtest" };
    const passed = ["HTTPS_PROXY", "NODE_EXTRA_CA_CERTS", "SSH_AUTH_SOCK", "GIT_AUTHOR_NAME"];
    assert.deepEqual(among(Object.keys(vars), Object.keys(await withEnv(vars, () => safeEnv()))), passed);
    // And the command itself sees them: its own names, printed by it.
    assert.deepEqual(among(Object.keys(vars), await withEnv(vars, namesSeen)), passed);
  });

  test("a family's name passes by its prefix where it does not read like a secret, as before", () => {
    const out = safeEnv({ env: envOf(["GIT_SSH_COMMAND", "GIT_TRACE", "npm_config_registry", "LC_ALL", "PATH", "HOME"]), pass: [], platform: "linux" });
    assert.deepEqual(names(out), ["GIT_SSH_COMMAND", "GIT_TRACE", "HOME", "LC_ALL", "PATH", "npm_config_registry"]);
  });
});

describe("what stays out", () => {
  test("a key, a token, a cloud's credentials, a family's name that reads like a secret, and a name nobody knows", () => {
    for (const platform of ["win32", "linux"]) assert.deepEqual(names(safeEnv({ env: envOf(SECRETS, "sk-shimtest"), pass: [], platform })), [], platform);
  });

  // (fails before: yes — no proxy passed at all, so none was weighed by its value; `npm_config_proxy` and
  // `npm_config_registry` passed with a password in them)
  test("an address with a password in it, whatever its variable: a proxy's in each spelling, npm's, a Go mirror's", () => {
    const secret = { HTTP_PROXY: WITH_PASSWORD, https_proxy: WITH_PASSWORD, ALL_PROXY: "socks5://shimtest:hunter2@proxy.test:1080", npm_config_proxy: WITH_PASSWORD, "npm_config_https-proxy": WITH_PASSWORD, npm_config_registry: "https://shimtest:hunter2@registry.test/", GOPROXY: "https://shimtest:hunter2@go.test,direct", HTTPS_PROXY: "shimtest:hunter2@proxy.test:8080" };
    assert.deepEqual(names(safeEnv({ env: secret, pass: [], platform: "linux" })), []);
    // Without a password each is an address like any other: a port, a user alone, a list of hosts.
    const plain = { HTTP_PROXY: "http://proxy.test:8080", https_proxy: "http://shimtest@proxy.test:8080", HTTPS_PROXY: "proxy.test:8080", NO_PROXY: "localhost,127.0.0.1,.corp.test:8443", npm_config_registry: "http://localhost:4873/", GOPROXY: "https://proxy.golang.org,direct" };
    assert.deepEqual(names(safeEnv({ env: plain, pass: [], platform: "linux" })), Object.keys(plain).sort());
  });

  // (fails before: yes — all four passed: an address's user with no colon after it was "a user alone", however long)
  // The second read of 11-12, its 15: a registry's or a mirror's token rides as the user alone (`https://<token>@host/`).
  test("an address whose user alone is a token — 20 characters or more, no colon —, whatever its variable; a short user alone passes still", () => {
    const token = "t".repeat(20);
    const secret = { GOPROXY: `https://${token}@go.test,direct`, npm_config_registry: `https://${token}@registry.test/`, HTTPS_PROXY: `${token}@proxy.test:8080`, GIT_SHIMTEST_REMOTE: `see https://proxy.golang.org and https://${token}xyz@git.test/org/repo.git` };
    assert.deepEqual(names(safeEnv({ env: secret, pass: [], platform: "linux" })), []);
    // Named by the person, it passes as it is: that is what naming it says.
    assert.deepEqual(names(safeEnv({ env: secret, pass: ["GOPROXY"], platform: "linux" })), ["GOPROXY"]);
    // A person's or an organisation's name is shorter: nineteen characters pass, with a scheme or (a proxy's) without;
    // and twenty before an @ that is no address's user — a path's, a query's — are no user.
    const user = "u".repeat(19);
    const plain = { GOPROXY: `https://${user}@go.test,direct`, npm_config_registry: `https://${user}@registry.test/`, HTTPS_PROXY: `${user}@proxy.test:8080`, https_proxy: "http://shimtest@proxy.test:8080", GIT_SSH_COMMAND: `ssh -l ${token} git@github.com`, GIT_SHIMTEST_REMOTE: `https://git.test/${token}@v2/x?as=${token}@y`, npm_config_cache: `/home/${token}@work/.npm` };
    assert.deepEqual(names(safeEnv({ env: plain, pass: [], platform: "linux" })), Object.keys(plain).sort());
  });

  test("git's config by environment, whole", () => {
    const env = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic c2hpbXRlc3Q=", GIT_CONFIG_GLOBAL: "/home/me/.gitconfig" };
    assert.deepEqual(names(safeEnv({ env, pass: [], platform: "linux" })), ["GIT_CONFIG_GLOBAL"], "its file's path is a setting like git's others");
  });

  // (fails before: yes — GIT_CONFIG_PARAMETERS passed by the `GIT_*` pattern: the rule knew the count, the keys and
  // the values alone)
  test("git's config in one variable, GIT_CONFIG_PARAMETERS, where a header's token rides as it does in a value — unless the person names it", () => {
    const env = { GIT_CONFIG_PARAMETERS: "'http.extraHeader=AUTHORIZATION: bearer c2hpbXRlc3Q='", GIT_CONFIG_NOSYSTEM: "1" };
    assert.deepEqual(names(safeEnv({ env, pass: [], platform: "linux" })), ["GIT_CONFIG_NOSYSTEM"]);
    assert.deepEqual(names(safeEnv({ env: { Git_Config_Parameters: env.GIT_CONFIG_PARAMETERS }, pass: [], platform: "win32" })), [], "on Windows in any case");
    assert.deepEqual(names(safeEnv({ env, pass: ["GIT_CONFIG_PARAMETERS"], platform: "linux" })), ["GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_PARAMETERS"]);
  });

  // (fails before: yes — GIT_PAT, GIT_PASS, GIT_PWD, GIT_CRED, GIT_CREDS and their like passed: the words a secret's
  // name was read for held none of pat, pass, pwd, cred)
  test("a family's name that says it holds a credential by a part of its own — the name split at _: PAT, PASS, PWD, CRED, CREDS", () => {
    const secret = "GIT_PAT GIT_PASS GIT_PWD GIT_CRED GIT_CREDS GIT_PASSWD GIT_CREDENTIAL GIT_CREDENTIALS GIT_SHIMTEST_PAT GIT_PAT_SHIMTEST Git_Http_Pass npm_config_pat npm_config_shimtest_pass LC_SHIMTEST_PWD".split(" ");
    for (const platform of ["win32", "linux"]) assert.deepEqual(names(safeEnv({ env: envOf(secret, "sk-shimtest"), pass: [], platform })), [], platform);
    assert.deepEqual(names(safeEnv({ env: envOf(secret), pass: ["GIT_PAT"], platform: "linux" })), ["GIT_PAT"], "named by the person, it passes");
    // A passphrase is a secret wherever the word stands, as a password is.
    for (const platform of ["win32", "linux"]) assert.deepEqual(names(safeEnv({ env: envOf(["GIT_SSH_PASSPHRASE", "npm_config_passphrase", "GIT_SHIMTESTPASSPHRASE"]), pass: [], platform })), [], platform);
    // By the part, never by the letters: a name that holds them inside a longer word is read as before.
    const plain = "GIT_ASKPASS GIT_EXEC_PATH GIT_LITERAL_PATHSPECS GIT_SSH_COMMAND GIT_COMPASS_HOME GIT_OLDPWD npm_config_path npm_config_passive npm_config_patch LC_PAPER".split(" ");
    for (const platform of ["win32", "linux"]) assert.deepEqual(names(safeEnv({ env: envOf(plain), pass: [], platform })), [...plain].sort(), platform);
    // What the list vouches for is not read for it, and what no list or family knows stays out, both as before.
    assert.deepEqual(names(safeEnv({ env: envOf("PATH PATHEXT PWD OLDPWD COMPASS_HOME".split(" ")), pass: [], platform: "linux" })), ["PATH", "PATHEXT"]);
  });

  test("Filament's own, but for a shell's tag", () => {
    const tag = "FILAMENT_SHELL_0123456789abcdef";
    const env = envOf(["FILAMENT_HOME", "FILAMENT_MEMORY_SIDECAR", "FILAMENT_TELEMETRY", tag]);
    assert.deepEqual(names(safeEnv({ env, pass: [], platform: "linux" })), [tag]);
    assert.deepEqual(names(safeEnv({ env: envOf(["Filament_Home", tag]), pass: [], platform: "win32" })), [tag], "on Windows in any case");
  });
});

describe("the names the person passes (`agentLoop.envPass`)", () => {
  // (fails before: yes — there was no such list: nothing let a name through that the code did not)
  test("a name passes whatever it reads like or holds: a proxy with its password, a key, git's config", () => {
    const env = { HTTPS_PROXY: WITH_PASSWORD, SHIMTEST_LICENCE_KEY: "sk-shimtest", GIT_CONFIG_COUNT: "0", ANTHROPIC_API_KEY: "sk-shimtest", HTTP_PROXY: WITH_PASSWORD };
    const out = safeEnv({ env, pass: ["HTTPS_PROXY", "SHIMTEST_LICENCE_KEY", "GIT_CONFIG_COUNT", "SHIMTEST_NOT_SET"], platform: "linux" });
    assert.deepEqual(names(out), ["GIT_CONFIG_COUNT", "HTTPS_PROXY", "SHIMTEST_LICENCE_KEY"], "what was named, and nothing beside it");
    assert.ok(Object.keys(out).every((k) => out[k] === /** @type {Record<string, string>} */ (env)[k]), "each as it is");
  });

  test("never one of Filament's own, named or not", () => {
    const tag = "FILAMENT_SHELL_0123456789abcdef";
    const env = envOf(["FILAMENT_HOME", "FILAMENT_PRESS_KEY", "filament_home", tag]);
    assert.deepEqual(names(safeEnv({ env, pass: ["FILAMENT_HOME", "FILAMENT_PRESS_KEY", "filament_home"], platform: "win32" })), [tag]);
    assert.deepEqual(names(safeEnv({ env: envOf(["FILAMENT_HOME", "FILAMENT_PRESS_KEY", tag]), pass: ["FILAMENT_HOME", "FILAMENT_PRESS_KEY"], platform: "linux" })), [tag]);
  });

  // (fails before: yes — the list's names were matched in any case on Windows already; a proxy's was on no list)
  test("on Windows a name is the same name in any case, the list's and the person's; elsewhere case is the name", () => {
    const env = envOf(["Https_Proxy", "ssh_auth_sock", "Git_Author_Name", "Shimtest_Licence_Key"]);
    assert.deepEqual(names(safeEnv({ env, pass: ["SHIMTEST_LICENCE_KEY"], platform: "win32" })), ["Git_Author_Name", "Https_Proxy", "Shimtest_Licence_Key", "ssh_auth_sock"]);
    assert.deepEqual(names(safeEnv({ env, pass: ["SHIMTEST_LICENCE_KEY"], platform: "linux" })), []);
    // The value's check is the proxy's in any case too.
    assert.deepEqual(names(safeEnv({ env: { Https_Proxy: "shimtest:hunter2@proxy.test:8080" }, pass: [], platform: "win32" })), []);
  });

  // (fails before: yes — `envPassFrom` is not a function)
  test("read where the composition root says, at each call; from nowhere once that is taken back, and where the read fails", async () => {
    const { envPassFrom } = await import("../src/adapters/tools/hands.js");
    const env = envOf(["SHIMTEST_LICENCE_KEY", "SHIMTEST_OTHER_TOKEN"]);
    /** @type {unknown} */
    let list = ["SHIMTEST_LICENCE_KEY"];
    const stop = envPassFrom(() => list);
    try {
      assert.deepEqual(names(safeEnv({ env })), ["SHIMTEST_LICENCE_KEY"]);
      list = ["SHIMTEST_OTHER_TOKEN", 7, null];
      assert.deepEqual(names(safeEnv({ env })), ["SHIMTEST_OTHER_TOKEN"], "the list as it stands now, its names alone");
      list = "SHIMTEST_LICENCE_KEY";
      assert.deepEqual(names(safeEnv({ env })), [], "no list, no name");
    } finally {
      stop();
    }
    assert.deepEqual(names(safeEnv({ env })), []);
    const stopFailing = envPassFrom(() => {
      throw new Error("no configuration yet");
    });
    try {
      assert.deepEqual(names(safeEnv({ env })), []);
      // A later reader is not undone by an earlier one's taking back.
      const later = envPassFrom(() => ["SHIMTEST_LICENCE_KEY"]);
      stopFailing();
      assert.deepEqual(names(safeEnv({ env })), ["SHIMTEST_LICENCE_KEY"]);
      later();
    } finally {
      stopFailing();
    }
  });
});

describe("the setting", () => {
  // (fails before: yes — the schema had no such leaf)
  test("a list of text beside the folders the agent may work in, empty by default", () => {
    const leaf = /** @type {any} */ (CONFIG_SCHEMA).agentLoop.envPass;
    assert.deepEqual([leaf.type, leaf.itemType, leaf.default], ["array", "string", []]);
    assert.deepEqual(defaultConfig().agentLoop.envPass, []);
    const keys = Object.keys(/** @type {any} */ (CONFIG_SCHEMA).agentLoop);
    assert.equal(keys[keys.indexOf("envPass") - 1], "roots");
  });

  // (fails before: yes — every one of these was a valid configuration)
  test("it holds names, never a value, and none of Filament's own: each refused in words that do not repeat a value", () => {
    /** @param {unknown} list */
    const check = (list) => {
      const cfg = defaultConfig();
      cfg.agentLoop.envPass = list;
      return validateConfig(cfg);
    };
    assert.deepEqual(check(["HTTPS_PROXY", "npm_config_//registry.npmjs.org/:_authToken", "CommonProgramFiles(x86)"]), { ok: true, errors: [] });
    const alone = (/** @type {number} */ i) => `agentLoop.envPass[${i}] must be a variable's name alone, such as HTTPS_PROXY: no value, no "=" and no space`;
    assert.deepEqual(check(["HTTPS_PROXY=http://shimtest:hunter2@proxy.test:8080"]).errors, [alone(0)]);
    assert.deepEqual(check(["OK", "two words", "", 7]).errors, [alone(1), alone(2), alone(3)]);
    assert.deepEqual(check(["FILAMENT_HOME", "filament_press_key"]).errors, [
      'agentLoop.envPass[0] "FILAMENT_HOME" is one of Filament\'s own variables, which no command is given',
      'agentLoop.envPass[1] "filament_press_key" is one of Filament\'s own variables, which no command is given',
    ]);
    assert.deepEqual(check("HTTPS_PROXY").errors, ["agentLoop.envPass must be a list of variable names"]);
  });
});

describe("written in Settings, a name reaches the next command", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let s;
  before(async () => {
    s = await startApp();
  });
  after(async () => {
    await s?.stop();
  });
  /** @param {any} body */
  const patch = async (body) => {
    const r = await s.api("/api/config/fields", { method: "PATCH", body });
    return { status: r.status, json: await r.json() };
  };
  const env = { HTTPS_PROXY: WITH_PASSWORD, SHIMTEST_LICENCE_KEY: "sk-shimtest", SHIMTEST_OTHER_TOKEN: "sk-shimtest" };

  // (fails before: yes — 400, "agentLoop.envPass is not a setting")
  test("a name written is passed from the next command on, by the command's own word; taken out, it is not", async () => {
    assert.deepEqual(names(safeEnv({ env })), []);
    const r = await patch({ set: { "agentLoop.envPass": [" HTTPS_PROXY ", "SHIMTEST_LICENCE_KEY", "HTTPS_PROXY"] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.values, { "agentLoop.envPass": ["HTTPS_PROXY", "SHIMTEST_LICENCE_KEY"] }, "each name once, as it is spelled");
    assert.deepEqual(names(safeEnv({ env })), ["HTTPS_PROXY", "SHIMTEST_LICENCE_KEY"]);
    assert.deepEqual(among(Object.keys(env), await withEnv(env, namesSeen)), ["HTTPS_PROXY", "SHIMTEST_LICENCE_KEY"]);
    const back = await patch({ unset: ["agentLoop.envPass"] });
    assert.equal(back.status, 200, JSON.stringify(back.json));
    assert.deepEqual(names(safeEnv({ env })), []);
  });

  // (fails before: yes — 400 for another reason: no such setting)
  test("a value typed with its name, and one of Filament's own, are refused and nothing is kept; the refusal repeats no value", async () => {
    const typed = await patch({ set: { "agentLoop.envPass": ["HTTPS_PROXY=http://shimtest:hunter2@proxy.test:8080"] } });
    assert.equal(typed.status, 400);
    assert.match(typed.json.error, /agentLoop\.envPass\[0\] must be a variable's name alone/);
    assert.doesNotMatch(JSON.stringify(typed.json), /hunter2|proxy\.test/);
    const own = await patch({ set: { "agentLoop.envPass": ["SHIMTEST_OTHER_TOKEN", "FILAMENT_PRESS_KEY"] } });
    assert.equal(own.status, 400);
    assert.match(own.json.error, /agentLoop\.envPass\[1\] "FILAMENT_PRESS_KEY" is one of Filament's own variables/);
    assert.deepEqual((await (await s.api("/api/state")).json()).config.agentLoop.envPass, []);
    assert.deepEqual(names(safeEnv({ env })), []);
  });
});

// (fails before: yes — r-hands' left, for the agents' versioned words (123): no shell tool's text said its command's
// environment is filtered, so an agent whose command failed for a missing variable could not tell the person the way on)
// The sentence carries no em dash: a coding agent reads it in background_command, whose texts have none (the owner's
// tool plan of 11-08, test/coder-tool-plan.test.js).
test("each shell tool's text says the filtered environment and the way on, in one sentence that is one constant", () => {
  assert.equal(ENV_WORDS, "The command runs with a filtered copy of the environment (what a build needs, no secrets): if it fails for a variable that is missing (a proxy with a password, a licence path, an SDK's home), name the variable and tell the person to add it under Settings › Agent loop › Variables passed to commands.");
  /** @param {string} name */
  const hand = (name) => String(HAND_TOOLS.find((t) => t.name === name)?.description);
  for (const kind of /** @type {const} */ (["git-bash", "cmd", "bash", "sh"]))
    assert.ok(bashDescription({ kind, name: "", file: "" }).includes(`a non-zero exit is an error. ${ENV_WORDS} Set timeout (seconds) for long commands;`), kind);
  for (const kind of /** @type {const} */ (["powershell", "pwsh"]))
    assert.ok(powershellDescription({ kind, name: "", file: "" }).includes(`and a non-zero exit is an error. ${ENV_WORDS} Set timeout (seconds) for long scripts.`), kind);
  assert.ok(hand("bash_background").endsWith(`read its new output with bash_output, stop it with bash_kill. ${ENV_WORDS}`), hand("bash_background"));
  assert.equal(MCP_TOOLS.find((t) => t.name === "Bash")?.description, `Run a shell command in the project folder and return its output. ${ENV_WORDS} Use \`timeout\` (ms) for long commands. Prefer Glob/Grep/Read for finding and reading files.`);
  for (const tool of [BACKGROUND_COMMAND_TOOL, BACKGROUND_COMMAND_MACHINE_TOOL])
    assert.ok(tool.description.includes(` in your project folder. ${ENV_WORDS} When the command ends, its result comes back to you whole `), tool.description);
  // Once in each, and in no tool that runs no command.
  const texts = [bashDescription({ kind: "bash", name: "", file: "" }), powershellDescription({ kind: "pwsh", name: "", file: "" }), hand("bash_background"), String(MCP_TOOLS.find((t) => t.name === "Bash")?.description), BACKGROUND_COMMAND_TOOL.description];
  assert.deepEqual(texts.map((t) => t.split(ENV_WORDS).length - 1), [1, 1, 1, 1, 1]);
  assert.deepEqual([...HAND_TOOLS, ...MCP_TOOLS].filter((t) => !["bash", "powershell", "bash_background", "Bash"].includes(t.name) && JSON.stringify(t).includes("filtered copy")).map((t) => t.name), []);
});

// (fails before: yes — `envPassFrom` is not a function, and nothing read the setting)
test("a Filament that has stopped passes none of its names on", async () => {
  const s = await startApp({ configure: (cfg) => void (cfg.agentLoop.envPass = ["SHIMTEST_LICENCE_KEY"]) });
  const env = envOf(["SHIMTEST_LICENCE_KEY"]);
  let running;
  try {
    running = names(safeEnv({ env }));
  } finally {
    await s.stop();
  }
  assert.deepEqual([running, names(safeEnv({ env }))], [["SHIMTEST_LICENCE_KEY"], []]);
});
