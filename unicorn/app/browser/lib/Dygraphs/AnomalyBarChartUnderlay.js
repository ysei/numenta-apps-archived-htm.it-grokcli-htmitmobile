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

import {anomalyScale, binarySearch} from '../../../common/common-utils';
import {
  ANOMALY_BAR_WIDTH , DATA_FIELD_INDEX, PROBATION_LENGTH
} from '../Constants';
import {mapAnomalyColor} from '../../lib/browser-utils';

const {
  DATA_INDEX_TIME, DATA_INDEX_ANOMALY
} = DATA_FIELD_INDEX;

// Anomaly bar padding in pixels
const PADDING = 3;

/**
 * Helper function to Draw a rectangle on a DyGraphs canvas.
 * @param {Object} canvas - Dygraphs Canvas DOM reference.
 * @param {Number} xStart - Starting X coordinate of rectangle.
 * @param {Number} yStart - Starting Y coordinate for rectangle.
 * @param {Number} width - Width of rectangle.
 * @param {Number} height - Height of rectangle.
 * @param {String} color - Color to fill in rectangle.
 */
function _drawRectangle(canvas, xStart, yStart, width, height, color) {
  canvas.fillStyle = new RGBColor(color).toRGB();
  canvas.fillRect(xStart, yStart, width, height);
}

/**
 * Update graph date windown
 * @param  {Object} dygraph    Dygraph instance
 * @param  {Array} dateWindow  [earliest, latest], where earliest/latest are
 *                             milliseconds since epoch.
 *                             see http://dygraphs.com/options.html#dateWindow
 */
function _updateDateWindow(dygraph, dateWindow) {
  setTimeout(() => {
    dygraph.updateOptions({dateWindow});
  });
}

/**
 * Compare function used to search row by time
 * @param  {Object}  current Current data recored
 * @param  {integer} key     Timestamp key (UTC miliseconds)
 * @return {integer}         0 for match,
 *                           negative value if current < key,
 *                           positive value if current > key
 * @see  {@link binarySearch}
 */
function _compare(current, key) {
  return current[DATA_INDEX_TIME].getTime() - key;
}

/**
 * DyGraph Custom Chart Underlay: AnomalyBarChart Plotter-like callback, for
 *  HTM Model Anomaly Result. Instead of using the Dygraph Chart Series rawData
 *  (which is already used and full), we send model data to the chart via
 *  customzing Dygraph's Underlay Callback. This is a much better simulation
 *  of a y3 axes, instead of a full custom plugin. Model Result data is forced
 *  in via the Dygraph.option with the key "modelData".
 * @param {Object} context - ModelData.jsx component context w/settings.
 * @param {Object} canvas - DOM Canvas object to draw with, from Dygraphs.
 * @param {Object} area - Canvas drawing area metadata, Width x Height info etc.
 * @param {Object} dygraph - Instantiated Dygraph library object itself.
 * @requries Dygraphs
 * @see view-source:http://dygraphs.com/tests/underlay-callback.html
 */
export default function (context, canvas, area, dygraph) {
  let modelData = dygraph.getOption('modelData') || [];
  if (modelData.length < 2) {
    // Not enough data
    return;
  }

  // Calculate number of bars based on the chart area
  let totalBars = Math.ceil(area.w / ANOMALY_BAR_WIDTH);

  // Update bar width based on actual bars to be displayed
  let barWidth = area.w / totalBars;

  // Get total points matching date window range
  let range = dygraph.xAxisRange();
  let firstPoint = binarySearch(modelData, range[0], _compare);
  if (firstPoint < 0) {
    firstPoint = ~firstPoint;
  }

  let lastPoint =  binarySearch(modelData, range[1], _compare);
  if (lastPoint < 0) {
    lastPoint = ~lastPoint;
  }
  let totalPoints = lastPoint - firstPoint;
  let pointsPerBar = totalPoints / totalBars;

  // Validate date window range with visible bars
  let startTime = modelData[firstPoint][DATA_INDEX_TIME].getTime();
  let endTime = modelData[lastPoint][DATA_INDEX_TIME].getTime();

  // Not enough points, expand window
  if (totalPoints < totalBars) {
    let lastData = modelData.length - 1;
    // Try to expand to the right first
    if (firstPoint + totalBars < lastData) {
      endTime = modelData[firstPoint + totalBars][DATA_INDEX_TIME].getTime();
    } else {
      // Expand to the left
      startTime = modelData[lastData - totalBars][DATA_INDEX_TIME].getTime();
      endTime = modelData[lastData][DATA_INDEX_TIME].getTime();
    }
    _updateDateWindow(dygraph, [startTime, endTime]);
    return;
  }


  // Find X position for first visible bar by calculating the X position of
  // the initial data point translated by the number of bars up to the bar
  // containing the first visible point
  let firstBar = Math.floor(firstPoint / pointsPerBar);
  let initialX = dygraph.toDomXCoord(modelData[0][DATA_INDEX_TIME].getTime());
  let x = initialX + firstBar * barWidth;

  // Find first record after probation period
  let probationIndex = Math.min(PROBATION_LENGTH, modelData.length);

  // Render bars
  let anomaly, bar, color, height;
  for (bar=0; bar <= totalBars; bar++) {
    startTime = dygraph.toDataXCoord(x);
    firstPoint = binarySearch(modelData, startTime, _compare);
    if (firstPoint < 0) {
      firstPoint = ~firstPoint;
    }
    endTime = dygraph.toDataXCoord(x + barWidth);
    lastPoint = binarySearch(modelData, endTime, _compare);
    if (lastPoint < 0) {
      lastPoint = ~lastPoint;
    }

    // Check probation period
    if (firstPoint >= probationIndex) {
      // Find max anomaly
      anomaly = modelData
                  .slice(firstPoint, lastPoint)
                  .reduce((prev, current) => {
                    return Math.max(prev, current[DATA_INDEX_ANOMALY]);
                  }, 0);
      // Format anomaly bar
      height = anomalyScale(anomaly) * area.h;
      color = mapAnomalyColor(anomaly);
    } else {
      // Format probation period bar
      height = anomalyScale(0) * area.h;
      color = mapAnomalyColor(null);
    }

    _drawRectangle(canvas, x - (barWidth - PADDING) / 2, area.h-1,
                   barWidth - PADDING, -height, color);
    // Next bar
    x += barWidth;
  }
}
