<#
# ----------------------------------------------------------------------
# Numenta Platform for Intelligent Computing (NuPIC)
# Copyright (C) 2016, Numenta, Inc.  Unless you have purchased from
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
# Script used to build win32 version of Unicorn.
# Arguments:
#   1) nupic_version (i.e. "0.5.0")
#>
param (
    [string]$nupic_version = "0.5.0"
)

#>
# Configure npm
npm config set msvs_version 2015
npm config set npm_config_arch ia32

# Mount shared folder to 'x:' drive
# Must match shared folder name in vagrant file
# See 'config.vm.synced_folder')
net use x: \\VBOXSVR\shared /PERSISTENT:YES
pushd x:\

# Build python and nupic
pushd scripts\Windows64
powershell.exe -ExecutionPolicy RemoteSigned .\simple_build_portable_python_with_nupic.ps1 -nupic_version=$nupic_version
popd

# Clean, install, build and package windows version
npm run clean
npm install
npm run build:win
