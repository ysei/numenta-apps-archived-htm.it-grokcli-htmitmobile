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

import os

from infrastructure.utilities.exceptions import BuildFailureException
from infrastructure.utilities.path import changeToWorkingDir
from infrastructure.utilities.cli import runWithOutput

SCRIPTS_DIR = os.path.join(os.environ.get("PRODUCTS"), "htm.it", "htm", "it",
                           "pipeline", "scripts")



def buildHtmIt(env, pipelineConfig, logger):
  """
    Builds HTM-IT with given HTM-IT SHA.
    :param env: The environment which will be set before building

    :param pipelineConfig: dict of the pipeline config values, e.g.:
      {
        "buildWorkspace": "/path/to/build/in",
        "htmitRemote": "git@github.com:Numenta/numenta-apps.git",
        "htmitBranch": "main",
        "htmItSha": "HEAD",
        "pipelineParams": "{dict of parameters}",
        "pipelineJson": "/path/to/json/file"
      }

    :param logger: Logger object.

    :raises
      infrastructure.utilities.exceptions.BuildFailureException:
      This exception is raised if build fails.
  """
  try :
    sitePackagesDir = os.path.join(env["PRODUCTS"],
                                   "htm-it/lib/python2.7/site-packages")
    if not os.path.exists(sitePackagesDir):
      os.makedirs(sitePackagesDir)

    # Setup the baseline configuration
    with changeToWorkingDir(env["HTM_IT_HOME"]):
      runWithOutput("python setup.py configure_htm_it", env=env, logger=logger)
  except:
    logger.exception("Unknown failure")
    raise BuildFailureException("HTM-IT building failed. Exiting.")
