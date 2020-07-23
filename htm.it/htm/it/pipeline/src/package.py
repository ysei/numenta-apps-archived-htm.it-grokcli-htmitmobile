#!/usr/bin/env python
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

import argparse
import glob
import json
import os
import pkg_resources
import platform

from shutil import move

import yaml

from boto.s3.key import Key
from fabric.api import settings, shell_env
from fabric.operations import put
from fabric.contrib.files import exists

from infrastructure.utilities import exceptions
from infrastructure.utilities import jenkins
from infrastructure.utilities import diagnostics as log
from infrastructure.utilities import s3
from infrastructure.utilities.env import prepareEnv, prependPath
from infrastructure.utilities.path import changeToWorkingDir

PRODUCTS_PATH = os.environ.get("PRODUCTS")
OPERATIONS_SCRIPTS = os.path.join(PRODUCTS_PATH,
                                  "htm.it/htm/it/pipeline/scripts/rpm-creator")

g_config = yaml.load(pkg_resources.resource_stream(__name__,
                                                   "../conf/config.yaml"))
g_serverKey = os.path.join(os.path.expanduser("~"), ".ssh",
                           g_config["KEY"] + ".pem")



def uploadShaFiletoBucket(rpmName, filename, logger):
  """
    Uploads sha.json to bucket "builds.numenta.com"

    :param rpmName: For now, this is always HTM-IT
                    i.e., builds.numenta.com/htm-it.
    :param filename: The sha.json file which should be uploaded.
    :raises: re-raising the base exceptions..
  """
  try:
    bucket = s3.getS3Connection().get_bucket("builds.numenta.com")
    k = Key(bucket)
    path = "/rpm_sha_mappings"
    if "htm-it" is rpmName:
      uploadPath = os.path.join(path, rpmName)
    else:
      uploadPath = os.path.join(path, rpmName)
    k.key = os.path.join(uploadPath, filename)
    k.set_contents_from_filename(filename)
  except:
    logger.exception("Failed to upload sha %s file to bucket." % filename)
    raise


def checkExistsOnRpmbuild(rpmname, config, logger):
  """
    This method checks if a particular rpm is present in the
    rpmbuild.groksolutions.com repository.

    :param rpmName: The actuall rpm name which needs to be checked.
    :param config: This is a dict of configuration data.
    :returns: True if the rpm exists on rpmbuild.groksolutions.com else False
    :raises: re-raising the base exceptions.
  """
  try:
    with settings(host_string=os.environ["RPMBUILDBOX"],
                  key_filename=g_serverKey,
                  user=config["USER"], connection_attempts=10, warn_only=True):
      path = os.path.join(config["X86_64_REPO_PATH"], rpmname)
      return exists(path, use_sudo=False, verbose=True)
  except Exception:
    logger.exception("Failed to check if %s RPM "
                     "exist on rpmbuild.groksolutions.com" % rpmname)
    raise


def checkExistsOnS3(rpmName):
  """
    This method checks if a particular rpm is present in S3.

    :param rpmName: The actuall rpm name which needs to be checked.
    :returns: True if the rpm exists on S3 else False
  """
  bucket = s3.getS3Connection().get_bucket("public.numenta.com")
  key = bucket.get_key(os.path.join("/yum/x86_64", "%s" % rpmName))
  return True if key else False


def checkRpmExists(rpmName, sha, rpmNameDetails, config, logger):
  """
    This method reads the rpmName from sha.json from the bucket
    builds.numenta.com, and then checks if the rpm is present on
    rpmbuild.groksolutions.com or in S3

    :param rpmName: For now, this is always HTM-IT
                    i.e., builds.numenta.com/htm-it if checking for htm-it rpm
    :param sha: The sha of htm-it which we are searching for
    :rpmNameDetails: This is a dict which is used to store the RPM name
                     which we are searching for
    :returns: True if rpm exists on S3 and rpmbuild.groksolutions.com else False
    :raises: re-raising the base exceptions.
  """
  try:
    bucket = s3.getS3Connection().get_bucket("builds.numenta.com")
    path = "/rpm_sha_mappings"
    if "htm-it" is rpmName:
      uploadPath = os.path.join(path, rpmName)
    else:
      uploadPath = os.path.join(path, rpmName)
    key = bucket.get_key(os.path.join(uploadPath, "%s.json" % sha))
    if key:
      mappingDetails = json.loads(key.get_contents_as_string())
      if mappingDetails["sha"] == sha:

        # updating rpm details
        rpmNameDetails.update({rpmName: mappingDetails["rpm"]})
        rpmName = mappingDetails["rpm"]

        # check if it exists on rpmbuild
        existsOnRpmbuild = checkExistsOnRpmbuild(rpmName, config, logger)
        logger.info("%s rpm exists on rpmbuild: %s" % (rpmName,
                                                       existsOnRpmbuild))

        # check if it exists on s3
        existsOnS3 = checkExistsOnS3(rpmName)
        logger.info("%s rpm exists on S3: %s" % (rpmName, existsOnS3))

      if existsOnRpmbuild and existsOnS3:
        logger.info("%s rpm with %s sha exists on rpmbuild and S3" % (rpmName,
                                                                      sha))
        return True
      else:
        logger.info("%s rpm with %s sha does not exist on rpmbuild or S3" %
                                                                (rpmName, sha))
        return False
    else:
      logger.info("%s rpm with %s sha does not exist." % (rpmName, sha))
      return False
  except Exception:
    logger.exception("Failed while checking if RPM exists on s3 and "
                     "rpmbuild.groksolutions.com")
    raise


def createShaFile(nameOfRpmCreated, sha):
  """
  Creates the sha.json and writes a json which includes RPM name and sha.
  for eg :
  {"sha": "001dde486f8b97b645aee95543658af81cae05a6",
   "rpm": "htm-it-py27-groksolutions-1.6-20140818.22.38.06.x86_64.rpm"}
  :param nameOfRpmCreated: The rpm name which was created.
  :param sha: The sha is used as the name of the file.
  :returns: the name of file created
  """
  shaFileName = "%s.json" % sha
  with open(shaFileName, "w") as fp:
    values = {"rpm": "%s" % nameOfRpmCreated, "sha": "%s" % sha}
    json.dump(values, fp)
  return shaFileName


def moveRpmsToRpmbuild(rpmName, config, logger):
  """
  Copies an rpm from subordinate to rpmbuild.groksolutions.com

  :param rpmName: The rpm which is to be moved
  :param config: This is a dict of configuration data.
  :returns: The status which will be boolean
  :raises: re-raising the base exceptions.
  """
  try:
    with settings(host_string=os.environ["RPMBUILDBOX"],
                  key_filename=g_serverKey,
                  user=config["USER"], connection_attempts=10):
      localPath = os.path.join(OPERATIONS_SCRIPTS, rpmName)
      status = put(localPath.rstrip(), config["X86_64_REPO_PATH"])
      return status.succeeded
  except Exception:
    logger.exception("Failed to move RPM's to rpmbuild.")
    raise


def buildRpms(env, htmItSha, releaseVersion,
              artifactsDir, logger, config, htmitRemote):
  """
  Builds an rpm for htm-it

  Takes the sha according to htm-it and checks that the sha.json file
  is present (also checks if the rpm is present on rpmbuild and in S3), if
  not it creates the rpm.

  :param env: The environment variables which is set.
  :param htmItSha: The htm-it sha.
  :param releaseVersion: The product version which will be used
                         in the name of RPM
  :param artifactsDir: In this directory the artifacts will be stored.
  :param config: This is a dict of configuration data here we are using
                   AWS secret and access.
  :returns: syncRpmStatus(It is list which will help recongnize if RPM's rpm
            should be synced) and rpmNameDetails(It is a dict which contains the
            RPM name of HTM-IT)
  :raises: infrastructure.utilities.exceptions.MissingRPMError,
           when RPM is not found.
           infrastructure.utilities.exceptions.FailedToMoveRPM,
           if there is some error while moving RPM's to
           rpmbuild.groksolutions.com
  """

  rpmNameDetails = {}
  rpmName = "htm-it"
  try:
    syncRpm = False
    sha = htmItSha
    rpmExists = checkRpmExists(rpmName, sha, rpmNameDetails, config, logger)
    with shell_env(**env):
      if not rpmExists:
        logger.info("Creating %s rpm.", rpmName)

        # Clean stale rpms
        with changeToWorkingDir(OPERATIONS_SCRIPTS):
          try:
            # Delete any previously created rpm
            for name in glob.glob("nta-products-htm-it-*.rpm"):
              os.remove(name)
            log.printEnv(env, logger)
            infrastuctureCommonPath = os.path.join(PRODUCTS_PATH,
                                                   "infrastructure",
                                                   "infrastructure")

            command = ("%s/create-numenta-rpm" % infrastuctureCommonPath +
                       " --rpm-flavor htm-it" +
                       " --debug" +
                       " --cleanup-script htm.it/htm/it/pipeline/scripts/rpm-creator" +
                       "/clean-htm-it-tree-for-packaging" +
                       " --whitelist htm-it" +
                       " --whitelist nta.utils" +
                       " --whitelist htmengine" +
                       " --whitelist infrastructure" +
                       " --whitelist install-htm-it.sh" +
                       " --base-version " + releaseVersion +
                       " --description HTM-IT-installed-from-products-repo" +
                       " --rpm-name nta-products-htm-it" +
                       " --tempdir /tmp/htm-itbuild" +
                       " --setup-py-arguments develop" +
                       " --log-level debug" +
                       " --setup-py-dir nta.utils" +
                       " --setup-py-dir htmengine" +
                       " --setup-py-dir infrastructure" +
                       " --extend-pythonpath htm-it/lib/python2.7/site-packages" +
                       " --sha " + htmItSha +
                       " --artifact opt" +
                       " --git-url " + htmitRemote)
            # Due to some environment issue's I have used local here,
            # we can change this later.
            # fixme https://jira.numenta.com/browse/TAUR-797
            from fabric.api import local
            local(command)
            # getting name of the RPM created
            nameOfRpmCreated = glob.glob("nta-products-htm-it-*.rpm").pop()
            if not nameOfRpmCreated:
              raise exceptions.MissingRPMError("%s rpm name not found exiting"
                                               % rpmName)
            # Creating artifact
            with open("%s.txt" % rpmName, "w") as fp:
              fp.write(nameOfRpmCreated)

            logger.info("\n\n######### %s RPM created #########\n\n"
                        % rpmName)
          except:
            raise exceptions.RPMBuildingError("Failed while creating %s RPM."
                                              % rpmName)
          else:
            syncRpm = True

        filename = os.path.join(OPERATIONS_SCRIPTS, "%s.txt" % rpmName)
        # updating rpm details
        rpmNameDetails.update({rpmName:nameOfRpmCreated})
        # moving the rpms name to artifacts directory
        move(filename, artifactsDir)
        shaFileName = createShaFile(nameOfRpmCreated, sha)
        # move rpmname to rpmbuild
        status = moveRpmsToRpmbuild(nameOfRpmCreated, config, logger)
        if status:
          uploadShaFiletoBucket(rpmName, shaFileName, logger)
          # deleting the rpm after copying to rpmbuild
          os.remove("%s/%s" %  (OPERATIONS_SCRIPTS, nameOfRpmCreated))
        else:
          raise exceptions.FailedToMoveRPM("Failed to move rpms to "
                                           "rpmbuilder machine")
      else:
        logger.info("RPM for %s with %s sha already exists,"
                    "skipping creation of rpm!!", rpmName, sha)
    return syncRpm, rpmNameDetails
  except Exception:
    logger.exception("RPM building failed.")
    raise


def addAndParseArgs(jsonArgs):
  """
  This method parses the command line paramaters passed to the script.

  :returns: logger, buildWorkspace, htmItSha, releaseVersion,
            pipelineParams, pipelineJson
  """

  parser = argparse.ArgumentParser(description="Package tool for creating"
                                               " htm-it rpms")
  parser.add_argument("--pipeline-json", dest="pipelineJson", type=str,
                      help="The manifest file name")
  parser.add_argument("--build-workspace", dest="buildWorkspace", type=str,
                      help="Common dir prefix for htm-it")
  parser.add_argument("--htmItSha", dest="htmItSha", type=str,
                      help="The htmItSha for which are creating rpm")
  parser.add_argument("--htm-it-remote", dest="htmitRemote", type=str,
                      help="The htm-it remote you want to use, "
                           "e.g. git@github.com:Numenta/numenta-apps.git")
  parser.add_argument("--unit-test-status", dest="testStatus", type=str,
                      help="Unit test success status")
  parser.add_argument("--release-version", dest="releaseVersion", type=str,
                       help="Current release version, this will be used as base"
                       "version for htm-it and tracking rpm")
  parser.add_argument("--log", dest="logLevel", type=str, default="warning",
                      help="Logging level")

  args = {}
  if jsonArgs:
    args = jsonArgs
  else:
    args = vars(parser.parse_args())
  global g_logger

  g_logger = log.initPipelineLogger("packaging", logLevel=args["logLevel"])

  saneParams = {k:v for k, v in args.items() if v is not None}
  del saneParams["logLevel"]

  if "pipelineJson" in saneParams and len(saneParams) > 1:
    parser.error("Please provide parameters via JSON file or commandline,"
                   "but not both")

  if "pipelineJson" in saneParams:
    with open(args["pipelineJson"]) as paramFile:
      pipelineParams = json.load(paramFile)
  else:
    pipelineParams = saneParams

  g_logger.info("pipeline parameters:%s", pipelineParams)

  buildWorkspace = os.environ.get("BUILD_WORKSPACE",
                     pipelineParams.get("buildWorkspace",
                     pipelineParams.get("manifest", {}).get("buildWorkspace")))
  htmItSha = pipelineParams.get("htmItSha",
              pipelineParams.get("build", {}).get("htmItSha"))
  unitTestStatus = pipelineParams.get("testStatus",
                    pipelineParams.get("test", {}).get("testStatus"))
  releaseVersion = pipelineParams.get("releaseVersion",
                    pipelineParams.get("manifest", {}).get("releaseVersion"))
  htmitRemote = pipelineParams.get("htmitRemote",
                    pipelineParams.get("manifest", {}).get("htmitRemote"))

  if platform.system() not in "Linux":
    g_logger.error("RPM's will be built only on Linux (CentOS). Bailing out.")
    raise exceptions.FailedToCreateRPMOnNonLinuxBox("RPM's will not build")

  if not unitTestStatus:
    g_logger.error("Unit Test failed. RPM's will not be created.")
    raise exceptions.UnittestFailed("Unit Test failed")

  if buildWorkspace and htmItSha and htmitRemote:
    return (buildWorkspace, htmItSha, releaseVersion,
            pipelineParams, args["pipelineJson"], htmitRemote)
  else:
    parser.error("Please provide all parameters, "
                 "Use --help for further details")



def main(jsonArgs=None):
  """
    This is the Main fuction, which creates HTM-IT rpms and
    writes the status to the json file if it is json driven.

    :param jsonArgs: dict of pipeline-json and logLevel, defaults to empty
      dict to make the script work independently and via driver scripts.
      e.g. {"pipelineJson": <PIPELINE_JSON_PATH>,
            "logLevel": <LOG_LEVEL>}


    :raises: raises generic Exception if anything else goes wrong.
  """
  jsonArgs = jsonArgs or {}
  (buildWorkspace, htmItSha, releaseVersion,
   pipelineParams, pipelineJson, htmitRemote) = addAndParseArgs(jsonArgs)
  try:
    # TODO: TAUR-841: Use an IAM role on the the jenkins instances instead of
    # embedding the AWS keypair in the repo. Boto will take care of either
    # loading the key from the environment or from the IAM role automagically.
    if not (os.environ.get("AWS_ACCESS_KEY_ID") and
            os.environ.get("AWS_SECRET_ACCESS_KEY")):
      g_logger.error("Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY")
      raise exceptions.MissingAWSKeysInEnvironment("AWS keys are not set")

    env = prepareEnv(buildWorkspace, None, os.environ)
    artifactsDir = jenkins.createOrReplaceArtifactsDir(logger=g_logger)
    syncRpm, rpmNameDetails = buildRpms(env, htmItSha,
                                        releaseVersion, artifactsDir,
                                        g_logger, g_config, htmitRemote)
    packageRpm = {"syncRpm": syncRpm,
                  "htm-itRpmName": rpmNameDetails["htm-it"],
                  "repoName": "x86_64"}
    pipelineParams["packageRpm"] = packageRpm
    g_logger.debug(pipelineParams)
    if pipelineJson:
      with open(pipelineJson, 'w') as fp:
        fp.write(json.dumps(pipelineParams, ensure_ascii=False))
  except Exception:
    g_logger.exception("Unknown error occurred in pack RPM phase")
    raise



if __name__ == "__main__":
  main()
