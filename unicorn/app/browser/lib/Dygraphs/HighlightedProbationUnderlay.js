// Copyright © 2016, Numenta, Inc. Unless you have purchased from
// Numenta, Inc. a separate commercial license for this software code, the
// following terms and conditions apply:
//
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero Public License version 3 as published by the
// Free Software Foundation.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
// FOR A PARTICULAR PURPOSE. See the GNU Affero Public License for more details.
//
// You should have received a copy of the GNU Affero Public License along with
// this program. If not, see http://www.gnu.org/licenses.
//
// http://numenta.org/licenses/

import RGBColor from 'rgbcolor';

import {DATA_FIELD_INDEX, PROBATION_LENGTH} from '../Constants';

const {DATA_INDEX_TIME} = DATA_FIELD_INDEX;

/**
 * @param {Object} context - ModelData.jsx component context w/settings.
 * @param {Object} canvas - DOM Canvas object to draw with, from Dygraphs.
 * @param {Object} area - Canvas drawing area metadata, Width x Height info etc.
 * @param {Object} dygraph - Instantiated Dygraph library object itself.
 * @requries Dygraphs
 * @see view-source:http://dygraphs.com/tests/underlay-callback.html
 */
export default function (context, canvas, area, dygraph) {
  let modelData = dygraph.getOption('modelData') || [];
  let disabledColor = context.context.muiTheme.rawTheme.palette.disabledColor;
  let height = area.h;
  let probationIndex, time, width;

  if (!(modelData.length)) {
    return;  // no anomaly data
  }

  probationIndex = Math.min(PROBATION_LENGTH, modelData.length);
  time = modelData[probationIndex - 1][DATA_INDEX_TIME].getTime();
  width = Math.round(dygraph.toDomXCoord(time));

  // draw rectangle
  canvas.fillStyle = new RGBColor(disabledColor).toRGB();
  canvas.fillRect(0, height, width, -height);
}
