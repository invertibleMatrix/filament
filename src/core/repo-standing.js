// @ts-check
// Where a folder's repository stands, as one shape: the git adapter reads it (adapters/git/standing.js) and memory's
// briefing words it (services/memory/repo-lines.js), neither importing the other.

/**
 * @typedef {{ short: string, date: string, subject: string }} CommitLine  a commit as `git log` named it: its short id,
 *   the day it was committed (YYYY-MM-DD) and its subject
 * @typedef {{ files: number, added: number, removed: number }} Uncommitted
 * @typedef {object} WorktreeStanding  another worktree of the repository
 * @property {string} path  its top folder, as git spells it
 * @property {boolean} main  the repository's main folder
 * @property {string | null} branch  null when detached
 * @property {string | null} head  the short commit it is at
 * @property {boolean} onBase  it is on the base branch itself
 * @property {number | null} ahead  commits it has that the base lacks; null where git could not compare
 * @property {number | null} behind
 * @property {boolean} fresh  a branch that never moved since it was made: nothing of its own yet, not merged
 * @property {Uncommitted | null} uncommitted
 * @property {boolean} missing  its folder is gone
 * @property {string | null} unread  why it is named as git listed it, not read: the fence refuses its folder, git could
 *   not read it, or did not answer in time; null where it was read (or its folder is gone)
 * @typedef {object} RepoStanding
 * @property {string} place  the folder's top folder, as git spells it
 * @property {string | null} main  the repository's main folder
 * @property {boolean} worktree  the place is a linked worktree
 * @property {string | null} branch  null on a detached HEAD
 * @property {string | null} head  the short commit HEAD is at; null before the first commit
 * @property {string | null} base  the branch it is compared with (GW-D21)
 * @property {string | null} baseHead  the short commit the base is at
 * @property {boolean} onBase
 * @property {number | null} ahead
 * @property {number | null} behind
 * @property {boolean} fresh
 * @property {Uncommitted | null} uncommitted
 * @property {WorktreeStanding[]} worktrees  the other worktrees, the main folder first; Filament's helper copies left out
 * @property {number} moreWorktrees  the ones past those read, unread
 * @property {CommitLine[]} own  the commits HEAD has that the base lacks, newest first
 * @property {CommitLine[]} commits  the base's newest commits along its first parents (HEAD's where there is no base)
 */

export {};
