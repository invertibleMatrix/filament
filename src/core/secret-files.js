// @ts-check
// What holds a secret by its name: the folders that sign the person in elsewhere, which another machine's agents never
// reach here (http/admin/remote.js `agentFolderRefusal`), and the files a copy sent to another machine leaves out
// (adapters/git/send.js, the remote plan's cp-send) with those folders, where its repository does not track them. By
// names — and by a private key's header (`privateKeyIn`) in the first lines of a file, which its caller reads: nothing
// is read here.

/**
 * The folders that hold what signs the person in elsewhere — keys, tokens, a cloud's or a coding agent's credentials, a
 * keyring, a browser's cookies —, each as the names of its path from a home folder (or from AppData, Library). `.netrc`,
 * `.npmrc`, `.git-credentials`, `.pypirc` and `.vault-token` are files in the home folder itself, which the fence refuses
 * whole; in a project they are `secretFileOf`'s.
 */
export const CREDENTIAL_FOLDERS = Object.freeze([
  // Keys, and the clouds' and clusters' sign-ins: Google Cloud's and Docker's on Windows under AppData's Roaming (the
  // f-fence2 hunt's).
  [".ssh"], [".gnupg"], [".password-store"], [".aws"], [".azure"], [".config", "gcloud"], ["appdata", "roaming", "gcloud"], [".kube"], [".docker"],
  ["appdata", "roaming", "docker"], ["appdata", "roaming", "docker desktop"], [".terraform.d"], [".oci"], [".config", "doctl"],
  // The coding agents' and the forges' tokens: GitHub's CLI on Windows keeps its own under AppData's Roaming.
  [".claude"], [".codex"], [".config", "gh"], ["appdata", "roaming", "github cli"], ["appdata", "roaming", "gh"], [".config", "git"], [".config", "configstore"],
  // The package registries' tokens.
  [".gem"], [".cargo"], [".m2"], [".gradle"], ["appdata", "roaming", "nuget"],
  // The hosts' command lines.
  [".fly"], [".wrangler"], [".supabase"], [".config", "op"],
  // The system's keyrings and the browsers' profiles, whose cookies sign the person in.
  [".local", "share", "keyrings"], ["library", "keychains"], ["microsoft", "credentials"], ["microsoft", "protect"],
  ["google", "chrome"], [".config", "google-chrome"], [".config", "chromium"], ["microsoft", "edge"], [".mozilla"], ["mozilla", "firefox"],
]);

/**
 * The credentials folder a path's names are at or under, as `CREDENTIAL_FOLDERS` names it ("" for none), compared
 * without case as Windows and macOS name a folder. @param {string} path  either separator
 */
export const credentialFolderOf = (path) => credentialFoldersOf(path)[0] || "";

/** Every credentials folder a path's names are at or under, as `credentialFolderOf` finds one. @param {string} path */
const credentialFoldersOf = (path) => {
  const names = String(path ?? "").toLowerCase().split(/[\\/]+/);
  return CREDENTIAL_FOLDERS.filter((c) => names.some((_, i) => c.every((n, j) => names[i + j] === n))).map((c) => c.join("/"));
};

/**
 * Files a secret is kept in by their names: an environment's, however its name goes on (`.env.local`, `.env-production`,
 * `.env_local`), Wrangler's `.dev.vars`, a registry's or a host's token (Yarn's `.yarnrc`, NuGet's config, an SFTP
 * extension's `sftp.json`), a secrets file, a cloud's or a coding agent's credentials (a service account's key,
 * Firebase's admin key, AWS's `credentials.csv`, Azure Functions' `local.settings.json`), a saved sign-in (`token.json`,
 * `auth.json`), a cluster's `kubeconfig`, Android's signing passwords (`key.properties`), MySQL's client password
 * (`.my.cnf`), a private key, whatever follows its name (`id_rsa_work`), a deploy key.
 */
const SECRET_NAMES =
  /^(?:\.env(?:[._-].+)?|\.envrc|\.dev\.vars(?:\..+)?|settings\.local\.json|local\.settings\.json|\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|nuget\.config|sftp\.json|application_default_credentials\.json|\.netrc|_netrc|\.git-credentials|\.htpasswd|\.vault-token|\.pgpass|\.my\.cnf|\.?credentials(?:\.json|\.toml|\.csv)?|secrets\.(?:json|ya?ml|toml)|client_secret.*\.json|service[_-]?account(?:[_-]?key)?\.json|.*firebase-adminsdk.*\.json|token\.json|auth\.json|\.?kubeconfig(?:\.ya?ml)?|key\.properties|id_(?:rsa|dsa|ecdsa|ed25519)(?:[_.-].*)?|[\w.-]*deploy[_-]?key)$/i;
/** …and by their kinds: an environment's, keys, certificates with their keys, key stores, password vaults, a cloud's state, a VPN's profile. */
const SECRET_KINDS = /\.(?:env|pem|key|p12|pfx|p8|keystore|jks|kdbx|ppk|ovpn|tfstate(?:\.backup)?|tfvars(?:\.json)?)$/i;
/** What only shows the shape of a secret's file: `.env.example`, `.env-example`, a public key. */
const SHAPE_ONLY = /\.(?:example|sample|template|dist|defaults|pub)$|^\.env[_-](?:example|sample|template|dist|defaults)$/i;
/** A private key's first line, as PEM, OpenSSH and PGP write it. */
const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/;

/**
 * Whether a file's first lines, as its caller read them, hold a private key's header (`-----BEGIN … PRIVATE KEY-----`):
 * a key under a name that says nothing, or a cloud's service account as JSON. @param {string} head
 */
export const privateKeyIn = (head) => PRIVATE_KEY.test(String(head ?? ""));
/**
 * The credentials folders that, in a project, hold its settings rather than a sign-in: Claude Code's (its commands,
 * agents, settings) and Cargo's (`config.toml`). Their secrets' files are held back by their names (`credentials.toml`,
 * `.credentials.json`, the person's own `settings.local.json`), and any other credentials folder in them as anywhere.
 */
const PROJECT_SETTINGS = new Set([".claude", ".cargo"]);

/**
 * Why a file of a project is held back from a copy sent to another machine, by its path's names, in words; "" where it
 * is not: in a credentials folder (`credentialFolderOf`) but a project's settings' (`PROJECT_SETTINGS`), or a secret's
 * file by its name or kind (`.env`, `prod.env`, `.npmrc`, `id_ed25519`, `*.pem`). What shows only a secret's shape
 * (`.env.example`, `id_ed25519.pub`) goes.
 * @param {string} path  relative to the project, either separator
 */
export function secretFileOf(path) {
  const names = String(path ?? "").split(/[\\/]+/).filter(Boolean);
  const name = names.at(-1) || "";
  const folder = credentialFoldersOf(names.join("/")).find((f) => !PROJECT_SETTINGS.has(f));
  if (folder) return `in a credentials folder (${folder})`;
  if (SHAPE_ONLY.test(name)) return "";
  return SECRET_NAMES.test(name) || SECRET_KINDS.test(name) ? "a secret's file by its name" : "";
}
