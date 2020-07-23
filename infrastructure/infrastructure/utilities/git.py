# ----------------------------------------------------------------------
# Numenta Platform for Intelligent Computing (NuPIC)
# Copyright (C) 2015, Numenta, Inc.  Unless you have purchased from
# Numenta, Inc. a separate commercial license for this software code, the
# following terms and conditions apply:
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero Public License version 3 as
# published by the Free Software Foundation.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
# See the GNU Affero Public License for more details.
#
# You should have received a copy of the GNU Affero Public License
# along with this program.  If not, see http://www.gnu.org/licenses.
#
# http://numenta.org/licenses/
# ----------------------------------------------------------------------

"""
  Many git utilities needed by the pipelines
"""
from infrastructure.utilities.cli import executeCommand
from infrastructure.utilities.exceptions import (CommandFailedError,
                                                 DetachedHeadError)
from infrastructure.utilities.path import changeToWorkingDir



def checkKwargs(kwargs, validKwargs):
  invalidKwargs = set(kwargs) - validKwargs
  if invalidKwargs:
    raise TypeError("Invalid parameters passed %r" % invalidKwargs)



def checkIfOptionSet(option, kwargs):
  """
  Convenience function to check if a keyword arg exists and is set to True
  by the caller.

  :param option: The option that is being looked up.

  :param kwargs: Dict containing all the arguments passed to the function.

  :returns: True if option is present in kwargs and is set to True.

  :rtype: boolean
  """
  return option in kwargs and kwargs[option]



def getCommitCount(path, logger):
  """
  Get the commit count from a git directory tree

  :param str path: path to git directory

  :param logger: logger for additional debug info

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if path isn't in a git checkout

  :returns: total commit count for the git directory

  :rtype: str
  """
  with changeToWorkingDir(path):
    command = ("git", "rev-list", "HEAD", "--count")
    return executeCommand(command=command, logger=logger)



def getGitRootFolder(logger):
  """
  Return the root folder of the current git repo

  :param logger: logger for additional debug info

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if the command fails

  :returns: The full path of the root folder of the current git repo

  :rtype: str
  """
  command = ("git", "rev-parse", "--show-toplevel")
  return executeCommand(command=command, logger=logger)



def getModifiedFilesBetweenRevisions(startSha, endSha, logger):
  """
  Get a list of all files modified between revisions

  :param str startSha: SHA to start searching from

  :param str endSha: SHA to search until

  :param logger: logger for additional debug info

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if the command fails; typically because you are not executing from within a
    git repository

  :returns: A `set` of modified files or None if the command fails

  :rtype: set
  """
  command = ("git", "diff", "--name-only", "%s...%s" % (startSha, endSha))
  return set(executeCommand(command=command,
                            logger=logger).split("\n"))



def getCurrentSha(logger):
  """
  Get the current SHA of a given repo

  :param logger: logger for additional debug info

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if the command fails; typically because you are not executing from within a
    git repository

  :returns: The current SHA

  :rtype: str
  """
  command = ("git", "log", "-n1", "--pretty=%H")
  return executeCommand(command=command, logger=logger)



def getActiveBranch(logger):
  """
  Get the active branch name for the repository

  :param logger: logger for additional debug info

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if the command fails
  :raises infrastructure.utilities.exceptions.DetachedHeadError:
    if the git checkout is in a detached head state

  :returns: The active branch name or the current SHA if in a detached head
    state

  :rtype: str
  """
  command = ("git", "rev-parse", "--abbrev-ref", "HEAD")
  branch = executeCommand(command=command, logger=logger)
  if branch == "HEAD":
    raise DetachedHeadError("There is no active branch; the head is detached.")

  return branch


def clean(path, arguments, logger):
  """
  Changes to path, then runs git clean.

  :param str path: git directory to clean

  :param str arguments: str containing optional extra command line arguments
    for git clean, as you would type them on the command line. If you wanted
    to do `git clean -fd`, you'd set arguments to "-fd".

  :param logger: An initialized logger object

  :raises CommandFailedError: if git clean fails
  """
  assert logger
  assert isinstance(arguments, basestring), (
    "arguments must be a string, but is %r" % arguments)
  assert isinstance(path, basestring), "path must be a string, but is %r" % path

  command = ["git", "clean"]
  if arguments:
    command.append(arguments)
  logger.debug("* Running %s in %s", command, path)
  with changeToWorkingDir(path):
    return executeCommand(command=command, logger=logger)


def setRemoteURL(remote, url, path, logger):
  """
  Sets a git remote's url.

  :param str remote: Which git remote to alter

  :param str url: What to set the url to

  :param str path: git directory to reset

  :param logger: An initialized logger object

  :raises CommandFailedError: if git set-url fails
  """
  assert logger
  assert isinstance(path, basestring), (
    "path must be a string, but is %r" % path)
  assert isinstance(remote, basestring), (
    "remote must be a string, but is %r" % (remote))
  assert isinstance(url, basestring), "url must be a string, but is %r" % (url)

  logger.debug("* Setting url for %s to %s in %s", remote, url, path)
  with changeToWorkingDir(path):
    return executeCommand(command="git set-url %s %s" % (remote, url),
                          logger=logger)


def clone(gitURL, logger, **kwargs):
  """
  Clones the given git repository

  :param str gitURL: The repository URL.

  :param str logger: logger for additional debug info

  :param str directory: Optional. If passed, name of the directory where
    repository will be cloned.

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if the command fails

  :returns: The blob output of git clone

  :rtype: str
  """
  validKwargs = {"directory"}
  checkKwargs(kwargs=kwargs, validKwargs=validKwargs)
  command = ["git", "clone", gitURL]
  if checkIfOptionSet("directory", kwargs):
    command.append(kwargs["directory"])
  return executeCommand(command=command, logger=logger)



def checkout(pathspec, logger, **kwargs):
  """
  Switches to a given commit-ish

  :param str pathspec: The name of the branch (commit-ish)

  :param logger: logger for additional debug info

  :param bool new: Boolean. Defaults to False. If True, create a new branch.

  :param bool orphan: Boolean. Defaults to False. If True, create a new orphan
    branch.

  :param bool theirs: Boolean. Defaults to False. If True, when checking out
    paths from the index, check out stage #3 (theirs) for unmerged paths.

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if the command fails

  :raises TypeError: Raised in following cases.
    - If invalid parameter is passed in **kwargs
    - More than one arguments are passed in **kwargs

  :returns: The text blob output of git checkout

  :rtype: str
  """
  validKwargs = {"new", "orphan", "theirs"}
  checkKwargs(kwargs=kwargs, validKwargs=validKwargs)
  command = ["git", "checkout"]
  if len(kwargs) > 1:
    raise TypeError("Invalid parameters passed.")
  if checkIfOptionSet("new", kwargs):
    command.append("-b")
  elif checkIfOptionSet("orphan", kwargs):
    command.append("--orphan")
  elif checkIfOptionSet("theirs", kwargs):
    command.append("--theirs")

  command.append(pathspec)
  return executeCommand(command=command, logger=logger)



def checkoutNewBranch(pathspec, logger):
  """
  Convenience function to create and switch to a new branch.

  :param str pathspec: Name of the branch to be checked out.

  :param logger: logger for additional debug info

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if the command fails

  :returns: The text blob output of git checkout

  :rtype: str
  """
  return checkout(pathspec=pathspec, new=True, logger=logger)



def checkoutOrphan(pathspec, logger):
  """
  Convenience function to create a orphan branch and switch to it.

  :param str pathspec: Branch name.

  :param logger: logger for additional debug info

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if the command fails

  :returns: The text blob output of git checkout

  :rtype: str
  """
  return checkout(pathspec=pathspec, orphan=True, logger=logger)



def reset(sha, logger, **kwargs):
  """
  Resets the repository to a optional SHA. Optional argument for --hard

  :param logger: logger for additional debug info

  :param bool hard: Boolean. Defaults to False. If true, resets the index and
    working tree. Any changes to tracked files in the working tree since
    <commit> are discarded.

  :raises infrastructure.utilities.exceptions.CommandFailedError: if the
    command fails

  :returns: The exit code

  :rtype: int
  """
  assert logger
  validKwargs = {"hard"}
  checkKwargs(kwargs=kwargs, validKwargs=validKwargs)
  command = ["git", "reset"]
  if checkIfOptionSet("hard", kwargs):
    command.append("--hard")
  command.append(sha)
  return executeCommand(command=command, logger=logger)



def resetHard(sha, logger):
  """
  A convenience function that runs 'git reset --hard' for the given SHA.
  Calls reset(SHA, **kwargs).

  :param str SHA: The SHA or commit-sh to which the code needs to be reset to.

  :param logger: logger for additional debug info

  :raises:
    infrastructure.utilities.exceptions.CommandFailedError: if
    the command fails

  :returns: The exit code

  :rtype: int
  """
  assert logger
  return reset(sha=sha, logger=logger, hard=True)



def revParse(commitish, logger, **kwargs):
  """
  Helper method to execute git rev-parse commands. Used to print the SHA1
  given a revision specifier (e.g HEAD). This function can return the output
  of the command executed or the exit code of the command executed if
  "exitcode" = True is passed as a keyword argument.

  :param str commitish: The commit-ish.

  :param logger: logger for additional debug info

  :param bool verify: Boolean. Defaults to False. If True, verify that exactly
    one parameter is provided, and that it can be turned into a raw
    20-byte SHA-1 that can be used to access the object database.

  :param bool quiet: Boolean. Defaults to False. Only valid with verify. If
    True, do not output an error message if the first argument is not a valid
    object name; instead exit with non-zero status silently. 'verify' must be
    True.

  :param bool abbrevRef: Boolean. Defaults to False. If True, a non-ambiguous
    short name of the objects name. 'TypeError' exception will be raised if
    'verify' and/or 'quiet' parameters are passed.

  :raises infrastructure.utilities.exceptions.CommandFailedError: if the
    command fails

  :raises TypeError: Raised in following cases.
    - Invalid parameter is passed in **kwargs
    - "quiet" parameter is set without setting "verify" parameter
    - Both "verify" and "abbrevRef" parameters are set.

  :returns: A `string` representing a SHA or the exit code of the command.

  :rtype: str or int
  """
  validKwargs = {"verify", "quiet", "abbrevRef"}
  checkKwargs(kwargs=kwargs, validKwargs=validKwargs)
  if (("quiet" in kwargs and "verify" not in kwargs)
      or ("abbrevRef" in kwargs and "verify" in kwargs)):
    raise TypeError("Invalid parameters passed.")

  command = ["git", "rev-parse"]
  if checkIfOptionSet("verify", kwargs):
    command.append("--verify")
    if checkIfOptionSet("quiet", kwargs):
      command.append("--quiet")
  elif checkIfOptionSet("abbrevRef", kwargs):
    command.append("--abbrev-ref")

  command.append(commitish)
  return executeCommand(command=command, logger=logger)


def fetch(repository, refspec, logger):
  """
  Download objects and refs from another repository

  :param str repository: Name of git repository (e.g origin)

  :param str refspec: Name of the refspec (e.g. main)

  :param logger: logger for additional debug info

  :raises:
    infrastructure.utilities.exceptions.CommandFailedError: if
    the command fails
  """
  command = ("git", "fetch", repository, refspec)
  return executeCommand(command=command, logger=logger)


def pull(logger, arguments=None):
  """
  Do a git pull, with optional parameters.

  Example usage:

    pull(arguments=["origin", "next"])
    pull(arguments=["origin", "next", "--ff-only"])
    pull(arguments=["git@github.com:username/repo.git", "next"])

  :param str arguments: Any extra arguments you want to pass to git pull
  :param logger: An initialized logger object
  """
  if arguments:
    assert (isinstance(arguments, basestring) or
            isinstance(arguments, tuple) or
            isinstance(arguments, list)), (
              "arguments must be a string or list, but is %r" % arguments)
  assert logger
  gitCommand = ["git", "pull"]
  if arguments:
    if isinstance(arguments, list) or isinstance(arguments, tuple):
      gitCommand.extend(arguments)
    if isinstance(arguments, basestring):
      arguments.extend(str.split(arguments))
  return executeCommand(command=gitCommand, logger=logger)


def showRef(refList, logger, **kwargs):
  """
  List references in a local repository


  :param str refList: Reference available in the local repository.

  :param logger: logger for additional debug info

  :param bool verify: Boolean. Defaults to False. If True, enable stricter
    reference checking by requiring an exact ref path.

  :raises infrastructure.utilities.exceptions.CommandFailedError: if the
    command fails
  """
  validKwargs = {"verify"}
  checkKwargs(kwargs=kwargs, validKwargs=validKwargs)
  command = ["git", "show-ref"]
  if checkIfOptionSet("verify", kwargs):
    command.append("--verify")
  command.append(refList)
  return executeCommand(command=command, logger=logger)



def add(pathspec, logger):
  """
  Add file contents to the index

  :param str pathspec: The file that is to be added to git.

  :param logger: logger for additional debug info

  :raises:
    infrastructure.utilities.exceptions.CommandFailedError: if
    the command fails
  """
  command = ("git", "add", pathspec)
  return executeCommand(command=command, logger=logger)



def commit(message, logger, **kwargs):
  """
  Record changes to the repository
  Current implementation is supporting options like --amend
  This could be extended for other options as when required

  :param str message: Commit message.

  :param logger: logger for additional debug info

  :param bool amend: Boolean. Defaults to False. If True, replace the tip of the
    current branch by creating a new commit.

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if the command fails
  """
  validKwargs = {"amend"}
  checkKwargs(kwargs=kwargs, validKwargs=validKwargs)
  command = ["git", "commit"]
  if checkIfOptionSet("amend", kwargs):
    command.append("--amend")
  command.append(message)
  return executeCommand(command=command, logger=logger)



def merge(path, message, logger, **kwargs):
  """
  Join two or more development histories together
  Current implementation supports --no-ff
  This could be extended for other options as when required.

  :param str path: The file or path that has to be removed.

  :param str message: Merge commit message.

  :param logger: logger for additional debug info

  :raises infrastructure.utilities.exceptions.CommandFailedError:
    if the command fails
  """
  validKwargs = {"noFF"}
  checkKwargs(kwargs=kwargs, validKwargs=validKwargs)
  command = ["git", "merge"]
  if checkIfOptionSet("noFF", kwargs):
    command.append("--no-ff")
  command.extend(["-m", message, path])
  return executeCommand(command=command, logger=logger)



def removeFileFromGit(path, logger):
  """
  Remove files from the working tree and from the index.

  :param str path: The file or path that has to be removed.

  :param logger: logger for additional debug info

  :raises infrastructure.utilities.exceptions.CommandFailedError: if the
    command fails

  :returns: output of git rm

  :rtype: str
  """
  command = ("git", "rm", "-rf", path)
  return executeCommand(command=command, logger=logger)



def getShaFromRemoteBranch(gitRemoteRepo, gitRemoteBranch, logger):
  """
  Get the actual SHA of the current HEAD of a remote repo / branch.

  :param str gitRemoteRepo: The URL of the remote repo,
    e.g., git@github.com:numenta/nupic.git
  :param str gitRemoteBranch: The name of the remote branch, e.g., main

  :param logger: logger for additional debug info

  :raises infrastructure.utilities.exceptions.CommandFailedError: if the
    command fails

  :returns: A `String` representing the SHA

  :rtype: str
  """
  command = ("git", "ls-remote", gitRemoteRepo)
  shaList = executeCommand(command=command, logger=logger)
  if gitRemoteBranch == "main":
    return shaList.split("\t")[0]
  else:
    formattedBranchName = "refs/heads/%s" % gitRemoteBranch
    for refShaPair in shaList.split("\n"):
      pair = refShaPair.split()
      if pair[1] == formattedBranchName:
        return pair[0]

  raise CommandFailedError("Could not find the specified branch %s on %s" %
                           gitRemoteBranch, gitRemoteRepo)
