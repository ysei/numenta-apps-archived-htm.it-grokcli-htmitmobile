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
import ReactDOM from 'react-dom';

import anomalyBarChartUnderlay from '../lib/Dygraphs/AnomalyBarChartUnderlay';
import axesCustomLabelsUnderlay from '../lib/Dygraphs/AxesCustomLabelsUnderlay';
import chartInteraction from '../lib/Dygraphs/ChartInteraction.js';
import Chart from './Chart';
import {
  DATA_FIELD_INDEX, PROBATION_LENGTH, ANOMALY_BAR_WIDTH
} from '../lib/Constants';
import {
  formatDisplayValue, mapAnomalyColor
} from '../lib/browser-utils';
import {anomalyScale, binarySearch, mapAnomalyText} from '../../common/common-utils';
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
 * Use a heuristic to compute the gap threshold which will be used to represent
 * timestamp gaps in the data.
 *
 * Heuristic for gap threshold:
 *
 * (1) Compute all the time-deltas between points.
 * (2) Find the 10th percentile of non-zero time-deltas and multiply it by the
 *     maximum number of missing anomaly bars (i.e. timestamp gaps in model
 *     results). Using the 10th percentile instead of the min time-delta value
 *     allows to be less sensitive to very small outliers.
 *
 * The result is the gap threshold.
 *
 * @param {Array} data - Array of arrays: [[Date, ...], [Date, ...], ...]
 * @returns {Array} - Tuple:
 *                    number: gap threshold
 *                    number: minimum time delta
 */
function computeGapThreshold(data) {
  let deltas = [];
  for (let i = 1; i < data.length; i++) {
    let delta = (data[i][DATA_INDEX_TIME].getTime() -
    data[i - 1][DATA_INDEX_TIME].getTime());
    if (delta > 0) {
      deltas.push(delta);
    }
  }
  deltas.sort((a, b) => a - b);

  let percentile = 0.1;
  let smallTimestampGap = deltas[Math.floor(deltas.length * percentile)];
  let maxMissingBars = 2;
  let minDelta = deltas.length ? deltas[0] : null;
  let gapThreshold = (1 + maxMissingBars) * smallTimestampGap;
  return [gapThreshold, minDelta];
}


/**
 * Detect gaps in timestamps in the data. Lines will be drawn for every
 * time-delta that is less than the gap threshold.
 *
 * At each gap, insert [midpointOfGap, vals[0], vals[1], ...] as a new datum.
 *
 * @param {Array} data - Array of arrays: [[Date, ...], [Date, ...], ...]
 * @param {Array} vals - Values concatenated to timestamp at every single gap
 * @param {Number} gapThreshold - Lines will be drawn for every time-delta that
 *                                is less than the gap threshold.
 * @returns {Array} - data with gap values inserted
 */
function insertIntoGaps(data, vals, gapThreshold) {
  let newData = [];
  data.forEach((item, rowid) => {
    newData.push(item);

    if (rowid + 1 < data.length) {
      let curr = item[DATA_INDEX_TIME].getTime();
      let next = data[rowid + 1][DATA_INDEX_TIME].getTime();
      let delta = next - curr;
      if (delta > gapThreshold) {
        let gapItem = [new Date(curr + delta / 2)].concat(vals);
        newData.push(gapItem);
      }
    }
  });

  return newData;
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
 *                    Array: The x values in the prepared data
 *                    Array: The y values in the prepared data
 *                    number: The minimum timestep delta in the model records,
 *                            or in the metric records as a fallback
 * @see http://dygraphs.com/tests/independent-series.html
 */
function prepareData(
  metricRecords, modelRecords, aggregated, rawDataInBackground) {
  let xValues = [];
  let yValues = [];

  let [gapThreshold, minDelta] = computeGapThreshold(modelRecords.length > 0
                                                     ? modelRecords
                                                     : metricRecords);

  let aggregatedChartData = null;
  if (modelRecords.length && aggregated) {
    modelRecords.forEach((item) => {
      xValues.push(item[DATA_INDEX_TIME]);
      yValues.push(item[DATA_INDEX_VALUE]);
    });

    if (rawDataInBackground) {
      aggregatedChartData = modelRecords.map(
        (item) => [item[DATA_INDEX_TIME],
          item[DATA_INDEX_VALUE],
          null]);

      aggregatedChartData = insertIntoGaps(aggregatedChartData,
        [NaN, null], gapThreshold);
    } else {
      aggregatedChartData = modelRecords.map(
        (item) => [item[DATA_INDEX_TIME],
          item[DATA_INDEX_VALUE]]);

      aggregatedChartData = insertIntoGaps(aggregatedChartData,
        [NaN], gapThreshold);
    }
  }

  let rawChartData = null;
  if (metricRecords.length && (!aggregated || rawDataInBackground)) {
    metricRecords.forEach((item) => {
      xValues.push(item[DATA_INDEX_TIME]);
      yValues.push(item[DATA_INDEX_VALUE]);
    });

    if (rawDataInBackground) {
      rawChartData = metricRecords.map(
        (item) => [item[DATA_INDEX_TIME],
          null,
          item[DATA_INDEX_VALUE]]);

      rawChartData = insertIntoGaps(rawChartData,
        [null, NaN], gapThreshold);
    } else {
      rawChartData = metricRecords.map(
        (item) => [item[DATA_INDEX_TIME],
          item[DATA_INDEX_VALUE]]);

      rawChartData = insertIntoGaps(rawChartData,
        [NaN], gapThreshold);
    }
  }

  let data = sortedMerge(
    aggregatedChartData, rawChartData,
    (a, b) => a[DATA_INDEX_TIME].getTime() - b[DATA_INDEX_TIME].getTime());

  return [data, xValues, yValues, minDelta];
}

/**
 * Determine an x scale using the current x scale and the model data.
 *
 * @param {Object} context - a ModelData instance
 * @param {Dygraph} g - a Dygraph instance
 * @returns {Array} the new x extent [min, max]
 */
function xScaleCalculate(context, g) {
  // Set a zoom limit.
  let dateWindow = g.xAxisRange();
  let adjusted = [dateWindow[0], dateWindow[1]];
  let {modelData} = context.props;

  if (modelData.data.length) {
    let data = modelData.data;

    // When there are only a few results, Dygraphs adds some padding.
    adjusted[0] = Math.max(adjusted[0], data[0][DATA_INDEX_TIME]);

    // Must be zoomed out enough that the space is filled with anomaly bars.
    let anomalyBarCount = g.getArea().w / ANOMALY_BAR_WIDTH;
    let minSpread = context._minTimeDelta * anomalyBarCount;
    let discrepancy = minSpread - (adjusted[1] - adjusted[0]);
    if (discrepancy > 0) {
      // Grow both sides, trying to hold the midpoint constant.
      adjusted[0] = Math.max(data[0][DATA_INDEX_TIME],
                             adjusted[0] - discrepancy/2);
      adjusted[1] = Math.min(data[data.length-1][DATA_INDEX_TIME],
                             adjusted[1] + discrepancy/2);
      discrepancy = minSpread - (adjusted[1] - adjusted[0]);
      if (discrepancy > 0) {
        // One of the sides hit the end. Put the remainder on the other side.
        adjusted[0] = Math.max(data[0][DATA_INDEX_TIME],
                               adjusted[0] - discrepancy);
        adjusted[1] = Math.min(data[data.length-1][DATA_INDEX_TIME],
                               adjusted[1] + discrepancy);
        discrepancy = minSpread - (adjusted[1] - adjusted[0]);
        if (discrepancy > 0) {
          // Both sides hit the end.
          // Force extra space to the right.
          adjusted[1] += discrepancy;
        }
      }
    }
  }

  return adjusted;
}

/**
 * Determine a y scale using the seen and unseen y values.
 *
 * Current strategy: use the minimum and maximum for the entire time series.
 * Additionally, make room for green anomaly bars.
 *
 * @param {Object} context - a ModelData instance
 * @param {Dygraph} g - a Dygraph instance
 * @returns {Array} the new y extent [min, max]
 */
function yScaleCalculate(context, g) {
  let yExtentAdjusted = [context._yExtent[0], context._yExtent[1]];

  // Add space for green anomaly bars.
  yExtentAdjusted[0] -= anomalyScale(0) * (yExtentAdjusted[1] -
                                           yExtentAdjusted[0]);

  return yExtentAdjusted;
}

function onChartResize(context) {
  // Get chart actual width used to calculate the initial number of bars
  let modelId = context.props.modelId;
  let chart = ReactDOM.findDOMNode(context.refs[`chart-${modelId}`]);
  context.setState({chartWidth: chart.offsetWidth});
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
    this._styles = {
      container: {
        position: 'relative'
      },
      legend: {
        section: {
          height: '1rem',
          fontSize: 12
        },
        label: {
          float: 'left'
        }
      },
      zoom: {
        section: {
          height: '1rem',
          fontSize: 12,
          float: 'right'
        },
        label: {
          color: muiTheme.rawTheme.palette.accent3Color,
          paddingRight: '1rem',
          fontWeight: 'bold'
        },
        link: {
          color: muiTheme.rawTheme.palette.primary1Color,
          paddingRight: '0.5rem',
          textDecoration: 'underline',
          cursor: 'pointer'
        },
        linkActive: {
          color: muiTheme.rawTheme.palette.textColor,
          paddingRight: '0.5rem',
          textDecoration: 'none',
          cursor: 'default'
        }
      }
    }

    this._xScaleCalculate = function (context, dygraph) {
      return xScaleCalculate(context, dygraph);
    }.bind(null, this);

    this._yScaleCalculate = function (context, dygraph) {
      return yScaleCalculate(context, dygraph);
    }.bind(null, this);

    this._onChartResize = onChartResize.bind(null, this);

    // Dygraphs Chart Options: Global and per-Series/Axis settings.
    this._chartOptions = {
      // Dygraphs global chart options
      options: {
        axisLineColor: muiTheme.rawTheme.palette.accent4Color,
        connectSeparatedPoints: true,  // required for raw+agg overlay
        interactionModel: chartInteraction,
        labelsShowZeroValues: true,
        labelsDiv: `legend-${props.modelId}`,
        plugins: [RangeSelectorBarChart],
        rangeSelectorPlotFillColor: muiTheme.rawTheme.palette.primary1FadeColor,
        rangeSelectorPlotStrokeColor: muiTheme.rawTheme.palette.primary1Color,
        showRangeSelector: true,
        underlayCallback: function (context, ...args) {
          axesCustomLabelsUnderlay(context, ...args);
          anomalyBarChartUnderlay(context, ...args);
        }.bind(null, this),
        xRangePad: 0,
        yRangePad: 4
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
        series: {
          NonAggregated: {
            axis: 'y',
            color: muiTheme.rawTheme.palette.primary1Color,  // light blue
            independentTicks: false,
            showInRangeSelector: false,
            strokeWidth: 2
          }
        }
      }
    }; // chartOptions

    this.state = {
      zoomLevel: 0,
      chartWidth: 400 // Replace with actual width when we know it.
    };
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
      if (anomalyIdx < PROBATION_LENGTH) {
        anomalyValue = null;
      } else if (anomalyIdx >= 0) {
        // Found exact value
        anomalyValue = modelData[anomalyIdx][DATA_INDEX_ANOMALY];
      } else {
        // Get max value from neighboring points
        let first = ~anomalyIdx;
        let second = first + 1;
        if (second >= modelData.length - 1) {
          second = modelData.length - 1;
        }
        anomalyValue = Math.max(modelData[first][DATA_INDEX_ANOMALY],
          modelData[second][DATA_INDEX_ANOMALY]);
      }
      // Format anomaly value
      if (anomalyValue || anomalyValue === null) {
        let color = mapAnomalyColor(anomalyValue);
        let anomalyText = mapAnomalyText(anomalyValue);
        displayValue += ` <font color="${color}"><b>Anomaly: ${anomalyText}` +
          `</b></font>`;
      }
    }
    return displayValue;
  }

  _handleZoom(zoomLevel) {
    this.setState({zoomLevel});
  }

  /**
   * Translate the zoom level into a resolution.
   *
   * A resolution has a timespan and a 'per' field.
   *
   * @param  {number} zoomLevel Percentage of data to display. [0..1]
   * @return {Object} a 'timespan' + 'per' pair
   */
  _getResolution(zoomLevel) {
    let {metricData, modelData} = this.props;

    let resolution;
    if (zoomLevel === 0) {
      let timespan;
      if (modelData.data.length) {
        timespan = this._minTimeDelta;
      } else {
        // Assume evenly distributed points. It might not be evenly distributed,
        // but it won't cause problems. If we used the min delta, it would cause
        // the chart to zoom too far if the data contains a single small delta.
        timespan = (this._xValues[this._xValues.length - 1] -
                    this._xValues[0]) / metricData.length;
      }

      resolution = {
        timespan,
        per: 'anomaly bar'
      };
    } else {
      resolution = {
        timespan: zoomLevel * (this._xValues[this._xValues.length - 1] -
                               this._xValues[0]),
        per: 'chart width'
      };
    }

    return resolution;
  }

  /**
   * Describe time zoom level rounding time rounded to the closest time
   * description (minute,  hour, day, week, month, ...) based .
   * @param  {number} zoomLevel Percentage of data to display. [0..1]
   * @return {string}           Human readable time period description.
   *                            For example:
   *                              All
   *                              15 minutes
   *                              8 hours
   *                              1 day
   *                              2 weeks
   *                              6 months
   */
  _describeZoomLevel(zoomLevel) {
    if (zoomLevel === 1) {
      // No zoom
      return this._config.get('chart:zoom:all');
    }

    let resolution = this._getResolution(zoomLevel);
    let chartWidthTimespan;
    if (resolution.per === 'anomaly bar') {
      chartWidthTimespan = resolution.timespan * (this.state.chartWidth /
                                                  ANOMALY_BAR_WIDTH);
    } else if (resolution.per === 'chart width') {
      chartWidthTimespan = resolution.timespan;
    }

    return moment.duration(chartWidthTimespan).humanize();
  }

  shouldComponentUpdate(nextProps, nextState) {
    let {model, modelData, showNonAgg} = this.props;

    // allow chart to switch between "show non-agg data" toggle states
    if (showNonAgg !== nextProps.showNonAgg) {
      return true;
    }
    if (nextState.zoomLevel !== this.state.zoomLevel) {
      return true;
    }
    if (nextState.chartWidth !== this.state.chartWidth) {
      return true;
    }

    // Only update if the model is visible and model data has changed
    if (model.visible && modelData.data.length) {
      return modelData.modified !== nextProps.modelData.modified ||
        this.props.model.active !== nextProps.model.active;
    }

    return true;
  }

  componentDidMount() {
    this._onChartResize();
    window.addEventListener('resize', this._onChartResize);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this._onChartResize);
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.model.active) {
      // Reset zoom level
      this.setState({zoomLevel: 0});
    }
  }

  _calculateState(props) {
    let {metric, metricData, model, modelData, showNonAgg} = props;
    let {options, raw, value} = this._chartOptions;

    metric.dataSize = metricData.length;
    model.dataSize = modelData.data.length;

    if (model.dataSize) {
      options.modelData = modelData.data;
    }

    const rawDataInBackground = (modelData.data.length &&
                                 model.aggregated &&
                                 showNonAgg);

    // Calculate axes, labels, and series. Grab them from the "value" options,
    // maybe insert the "raw" options, then overwrite the actual "options" that
    // get passed into Dygraphs.
    let {axes, labels, series} = value;
    if (rawDataInBackground) {
      labels = labels.concat(raw.labels);
      Object.assign(axes, raw.axes);
      Object.assign(series, raw.series);
    }
    Object.assign(options, {axes, labels, series});

    let [data,
         xValues,
         yValues,
         minDelta] = prepareData(metricData, modelData.data, model.aggregated,
                                 rawDataInBackground);

    this._data = data;
    this._xValues = xValues;
    this._yValues = yValues;
    this._minTimeDelta = minDelta;
    this._yExtent = [Math.min(...yValues),
                     Math.max(...yValues)];
  }

  componentWillUpdate(nextProps, nextState) {
    this._calculateState(nextProps);
  }

  componentWillMount() {
    this._calculateState(this.props);
  }

  render() {
    let {metric, model, modelData, modelId} = this.props;
    let metaData = {metric, model, modelData};
    let zoomLevel = this.state.zoomLevel;

    let zoomSection;
    if (!model.active) {
      // Render Zoom buttons
      let zoomButtons = [0, 0.25, 1].map((level) => {
        let style;
        if (level === zoomLevel) {
          style = this._styles.zoom.linkActive;
        } else {
          style = this._styles.zoom.link;
        }
        // Generate friendly zoom level description
        let label = this._describeZoomLevel(level);
        return (<a style={style} onClick={this._handleZoom.bind(this, level)}>
          {label}</a>);
      });
      zoomSection = (<section style={this._styles.zoom.section}>
        <span style={this._styles.zoom.label}>Zoom:</span>
        {zoomButtons}
      </section>);
    }

    return (
      <div style={this._styles.container}>
        {zoomSection}
        <section style={this._styles.legend.section}>
          <span id={`legend-${modelId}`} style={this._styles.legend.label}/>
        </section>
        <section>
          <Chart ref={`chart-${modelId}`}
                 data={this._data}
                 metaData={metaData}
                 canZoom={!model.active}
                 options={this._chartOptions.options}
                 resolution={this._getResolution(zoomLevel)}
                 xScaleCalculate={this._xScaleCalculate}
                 yScaleCalculate={this._yScaleCalculate}/>
        </section>
      </div>
    );
  }
}
