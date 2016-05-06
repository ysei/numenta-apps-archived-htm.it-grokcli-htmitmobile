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

import connectToStores from 'fluxible-addons-react/connectToStores';
import moment from 'moment';
import React from 'react';

import anomalyBarChartUnderlay from '../lib/Dygraphs/AnomalyBarChartUnderlay';
import axesCustomLabelsUnderlay from '../lib/Dygraphs/AxesCustomLabelsUnderlay';
import highlightedProbationUnderlay from '../lib/Dygraphs/HighlightedProbationUnderlay';
import Chart from './Chart';
import {DATA_FIELD_INDEX} from '../lib/Constants';
import Dygraph from '../lib/Dygraphs/DygraphsExtended';
import {
  formatDisplayValue, mapAnomalyColor
} from '../lib/browser-utils';
import {binarySearch, mapAnomalyText} from '../../common/common-utils';
import MetricStore from '../stores/MetricStore';
import MetricDataStore from '../stores/MetricDataStore';
import ModelStore from '../stores/ModelStore';
import ModelDataStore from '../stores/ModelDataStore';
import RangeSelectorBarChart from '../lib/Dygraphs/RangeSelectorBarChartPlugin';

const {
  DATA_INDEX_TIME, DATA_INDEX_VALUE, DATA_INDEX_ANOMALY
} = DATA_FIELD_INDEX;

/**
 * Merge two sorted arrays to create a new sorted array.
 * @param {Array} a - sorted array
 * @param {Array} b - sorted array
 * @param {Function} compareFunction - returns a negative number if arg1 < arg2
 * @returns {Array} - new sorted array
 */
function sortedMerge(a, b, compareFunction) {
  if (!a && !b) return [];
  if (!a) return b;
  if (!b) return a;

  let ret = [];
  let j = 0;

  for (let i = 0; i < a.length; i++) {
    for (; compareFunction(b[j], a[i]) < 0; j++) {
      ret.push(b[j]);
    }
    ret.push(a[i]);
  }

  for (; j < b.length; j++) {
    ret.push(b[j]);
  }

  return ret;
}

/**
 * Use a heuristic to detect gaps in timestamps in the data.
 *
 * At each gap, insert [midpointOfGap, vals[0], vals[1], ...] as a new datum.
 *
 * @param {Array} data - Array of arrays: [[Date, ...], [Date, ...], ...]
 * @param {Array} vals - Values concatenated to timestamp at every single gap
 * @returns {Array} - data with gap values inserted
 */
function insertIntoGaps(data, vals) {
  // Heuristic: do nothing.
  return data;
}

/**
 * Compute Dygraphs input from the metric and model data.
 *
 * If aggregated, the return value will contain properly formatted model
 * records, possibly with nonaggregated raw metric records inserted.
 *
 * If not aggregated, or if there are no modelRecords, the return value will
 * contain properly formatted raw metric records.
 *
 * In all cases, gaps are detected. NaN values are inserted to designate gaps.
 *
 * @param {Array} metricRecords - Input data record list, raw metric data.
 * @param {Array} modelRecords - Input data record list, model data.
 * @param {boolean} aggregated - Whether the model is aggregated.
 * @param {boolean} rawDataInBackground - Whether the raw data should be drawn
 *                                        (in addition to the aggregated data)
 * @returns {Array} - Tuple:
 *                    Array: Dygraphs multi-dimensional array
 *                    boolean: minVal
 *                    boolean: maxVal
 * @see http://dygraphs.com/tests/independent-series.html
 */
function prepareData(
  metricRecords, modelRecords, aggregated, rawDataInBackground) {
  let minVal = Number.POSITIVE_INFINITY;
  let maxVal = Number.NEGATIVE_INFINITY;

  let aggregatedChartData = null;
  if (modelRecords.length && aggregated) {
    modelRecords.forEach((item) => {
      minVal = Math.min(minVal, item[DATA_INDEX_VALUE]);
      maxVal = Math.max(maxVal, item[DATA_INDEX_VALUE]);
    });

    if (rawDataInBackground) {
      aggregatedChartData = modelRecords.map(
        (item) => [item[DATA_INDEX_TIME],
                   item[DATA_INDEX_VALUE],
                   null]);

      aggregatedChartData = insertIntoGaps(aggregatedChartData,
                                           [NaN, null]);
    } else {
      aggregatedChartData = modelRecords.map(
        (item) => [item[DATA_INDEX_TIME],
                   item[DATA_INDEX_VALUE]]);

      aggregatedChartData = insertIntoGaps(aggregatedChartData,
                                           [NaN]);
    }
  }

  let rawChartData = null;
  if (metricRecords.length && (!aggregated || rawDataInBackground)) {
    metricRecords.forEach((item) => {
      minVal = Math.min(minVal, item[DATA_INDEX_VALUE]);
      maxVal = Math.max(maxVal, item[DATA_INDEX_VALUE]);
    });

    if (rawDataInBackground) {
      rawChartData = metricRecords.map(
        (item) => [item[DATA_INDEX_TIME],
                   null,
                   item[DATA_INDEX_VALUE]]);

      rawChartData = insertIntoGaps(rawChartData,
                                    [null, NaN]);
    } else {
      rawChartData = metricRecords.map(
        (item) => [item[DATA_INDEX_TIME],
                   item[DATA_INDEX_VALUE]]);

      rawChartData = insertIntoGaps(rawChartData,
                                    [NaN]);
    }
  }

  let data = sortedMerge(
    aggregatedChartData, rawChartData,
    (a, b) => a[DATA_INDEX_TIME].getTime() - b[DATA_INDEX_TIME].getTime());

  return [data, minVal, maxVal];
}

/**
 * React Component for sending Model Data from Model component to
 *  Chart component.
 */
@connectToStores([MetricStore, MetricDataStore, ModelStore, ModelDataStore],
  (context, props) => {
    let modelId = props.modelId;
    let metric = context.getStore(MetricStore).getMetric(modelId);
    let metricData = context.getStore(MetricDataStore).getData(modelId);
    let model = context.getStore(ModelStore).getModel(modelId);
    let modelData = context.getStore(ModelDataStore).getData(modelId);
    return {metric, metricData, model, modelData, modelId};
  }
)
export default class ModelData extends React.Component {

  static get contextTypes() {
    return {
      getConfigClient: React.PropTypes.func,
      getStore: React.PropTypes.func,
      muiTheme: React.PropTypes.object
    };
  }

  static get propTypes() {
    return {
      modelId: React.PropTypes.string.isRequired,
      showNonAgg: React.PropTypes.bool
    };
  }

  constructor(props, context) {
    super(props, context);
    this._config = this.context.getConfigClient();

    let muiTheme = this.context.muiTheme;
    let displayPointCount = this._config.get('chart:points');

    this._styles = {
      container: {
        position: 'relative'
      },
      legendSection: {
        height: '1rem',
        fontSize: 12
      },
      legend: {
        float: 'left'
      }
    }
    this._anomalyBarWidth = Math.round(displayPointCount / 16, 10);

    // Dygraphs Chart Options: Global and per-Series/Axis settings.
    this._chartOptions = {
      // Dygraphs global chart options
      options: {
        axisLineColor: muiTheme.rawTheme.palette.accent4Color,
        connectSeparatedPoints: true,  // required for raw+agg overlay
        includeZero: true,
        interactionModel: Dygraph.Interaction.dragIsPanInteractionModel,
        labelsShowZeroValues: true,
        labelsDiv: `legend-${props.modelId}`,
        plugins: [RangeSelectorBarChart],
        rangeSelectorPlotFillColor: muiTheme.rawTheme.palette.primary1FadeColor,
        rangeSelectorPlotStrokeColor: muiTheme.rawTheme.palette.primary1Color,
        showRangeSelector: true,
        underlayCallback: function (context, ...args) {
          highlightedProbationUnderlay(context, ...args);
          axesCustomLabelsUnderlay(context, ...args);
          anomalyBarChartUnderlay(context, ...args);
        }.bind(null, this),
        xRangePad: 0,
        yRangePad: 0
      },

      // main value data chart line (could be either Raw OR Aggregated data)
      value: {
        labels: ['Time', 'Value'],
        axes: {
          x: {
            axisLabelOverflow: false,
            axisLabelWidth: 0,
            drawAxis: false,
            drawGrid: false,
            valueFormatter: (time) => moment.utc(time).format('llll')
          },
          y: {
            axisLabelOverflow: false,
            axisLabelWidth: 0,
            drawAxis: false,
            drawGrid: false,
            valueFormatter: ::this._legendValueFormatter
          }
        },
        series: {
          Value: {
            axis: 'y',
            color: muiTheme.rawTheme.palette.primary2Color,  // dark blue
            independentTicks: false,
            showInRangeSelector: true,  // plot alone in range selector
            strokeWidth: 2
          }
        }
      },

      // non-aggregated line chart overlay on top of aggregated data line chart
      raw: {
        labels: ['NonAggregated'],
        axes: {
          y2: {
            axisLabelOverflow: false,
            axisLabelWidth: 0,
            drawAxis: false,
            drawGrid: false,
            valueFormatter: ::this._legendValueFormatter
          }
        },
        series: {
          NonAggregated: {
            axis: 'y2',
            color: muiTheme.rawTheme.palette.primary1Color,  // light blue
            independentTicks: false,
            showInRangeSelector: false,
            strokeWidth: 2
          }
        }
      }
    }; // chartOptions
  } // constructor

  /**
   * Format Values & Anomalies for Dygraph Chart Legend. Add Anomaly when there.
   * @param {Number} numOrTime - UTC epoch milisecond stamp of current value point
   * @param {Function} options - options('key') same as dygraph.getOption('key')
   * @param {String} series - Name of series
   * @param {Object} dygraph - Instantiated Dygraphs charting object
   * @param {Number} row - Current row (series)
   * @param {Number} column - Current column (data index)
   * @returns {Number|String} - Valueset for display in Legend
   * @see http://dygraphs.com/options.html#valueFormatter
   */
  _legendValueFormatter(numOrTime, options, series, dygraph, row, column) {
    let modelData = options('modelData');  // custom
    let value = formatDisplayValue(dygraph.getValue(row, column));

    // Format data value
    let valueColor = options('series')[series]['color'];
    let displayValue = `<font color="${valueColor}"><b>${value}</b></font>`;
    // Show anomaly
    if (modelData) {
      // Get time value
      let time = dygraph.getValue(row, 0);

      // Find anomaly closest to the time
      let anomalyIdx = binarySearch(modelData, time, (current, key) => {
        return current[DATA_INDEX_TIME].getTime() - key;
      });
      let anomalyValue;
      if (anomalyIdx >= 0) {
        // Found exact value
        anomalyValue = modelData[anomalyIdx][DATA_INDEX_ANOMALY];
      } else {
        // Get max value from neighboring points
        let first = -anomalyIdx;
        let second = first + 1;
        if (second >= modelData.length - 1) {
          second = modelData.length - 1;
        }
        anomalyValue = Math.max(modelData[first][DATA_INDEX_ANOMALY],
                                modelData[second][DATA_INDEX_ANOMALY]);
      }
      // Format anomaly value
      if (anomalyValue) {
        let color = mapAnomalyColor(anomalyValue);
        let anomalyText = mapAnomalyText(anomalyValue);
        displayValue += ` <font color="${color}"><b>Anomaly: ${anomalyText}` +
                        `</b></font>`;
      }
    }
    return displayValue;
  }

  shouldComponentUpdate(nextProps, nextState) {
    let {model, modelData, showNonAgg} = this.props;

    // allow chart to switch between "show non-agg data" toggle states
    if (showNonAgg !== nextProps.showNonAgg) {
      return true;
    }

    // Only update if the model is visible and model data has changed
    if (model.visible && modelData.data.length) {
      return modelData.modified !== nextProps.modelData.modified;
    }

    return true;
  }

  render() {
    let {
      metric, metricData, model, modelData, showNonAgg, modelId
    } = this.props;
    let {options, raw, value} = this._chartOptions;
    let {axes, labels, series} = value;
    let metaData = {metric, model, min: -Infinity, max: Infinity};

    if (metricData.length) {
      metaData.metric.dataSize = metricData.length;
    }

    if (modelData.data.length) {
      options.modelData = modelData.data;
      metaData.model.dataSize = modelData.data.length;
    }

    const rawDataInBackground = (modelData.data.length &&
                                 model.aggregated &&
                                 showNonAgg);
    if (rawDataInBackground) {
      labels = labels.concat(raw.labels);
      Object.assign(axes, raw.axes);
      Object.assign(series, raw.series);
    }

    let [data, minVal, maxVal] = prepareData(metricData, modelData.data,
                                             model.aggregated,
                                             rawDataInBackground);

    metaData.min = minVal;
    metaData.max = maxVal;

    // RENDER
    Object.assign(options, {axes, labels, series});
    return (
      <div style={this._styles.container}>
        <section style={this._styles.legendSection}>
          <span id={`legend-${modelId}`} style={this._styles.legend}></span>
        </section>
        <section>
          <Chart data={data} metaData={metaData} options={options} />
        </section>
      </div>
    );
  }
}
