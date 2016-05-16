// Copyright © 2016, Numenta, Inc.  Unless you have purchased from
// Numenta, Inc. a separate commercial license for this software code, the
// following terms and conditions apply:
//
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero Public License version 3 as published by the Free
// Software Foundation.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
// FOR A PARTICULAR PURPOSE. See the GNU Affero Public License for more details.
//
// You should have received a copy of the GNU Affero Public License along with
// this program.  If not, see http://www.gnu.org/licenses.
//
// http://numenta.org/licenses/

import CircularProgress from 'material-ui/lib/circular-progress';
import Paper from 'material-ui/lib/paper';
import React from 'react';
import ReactDOM from 'react-dom';

import ChartUpdateViewpoint from '../actions/ChartUpdateViewpoint';
import Dygraph from 'dygraphs';
import '../lib/Dygraphs/Plugins';
import CustomDygraph from '../lib/Dygraphs/CustomDygraph';
import {ANOMALY_BAR_WIDTH, DATA_FIELD_INDEX} from '../lib/Constants';

const {DATA_INDEX_TIME} = DATA_FIELD_INDEX;
const RANGE_SELECTOR_CLASS = 'dygraph-rangesel-fgcanvas';

function getDateWindowWidth(resolution, chartElement) {
  switch (resolution.per) {
  case 'anomaly bar':
    return resolution.timespan * (chartElement.offsetWidth / ANOMALY_BAR_WIDTH);
  case 'chart width':
    return resolution.timespan;
  default:
    throw new Error(`Unrecognized resolution 'per': ${resolution.per}`);
  }
}

/**
 * Chart Widget. Wraps as a React Component.
 * @see http://dygraphs.com/
 */
export default class Chart extends React.Component {

  static get contextTypes() {
    return {
      executeAction: React.PropTypes.func,
      getConfigClient: React.PropTypes.func,
      muiTheme: React.PropTypes.object
    };
  }

  static get propTypes() {
    return {
      data: React.PropTypes.array.isRequired,
      metaData: React.PropTypes.object,
      options: React.PropTypes.object,
      canZoom: React.PropTypes.boolean,
      zDepth: React.PropTypes.number
    };
  }

  static get defaultProps() {
    return {
      data: [],
      metaData: {},
      options: {},
      zDepth: 1
    };
  }

  constructor(props, context) {
    super(props, context);
    this._jumpToNewResults = true;
    this._config = this.context.getConfigClient();

    // DyGraphs chart container
    this._dygraph = null;
    this._chartRange = [null, null];
    this._previousDataSize = 0;

    // dynamic styles
    let muiTheme = this.context.muiTheme;
    this._styles = {
      root: {
        boxShadow: 'none',
        height: muiTheme.rawTheme.spacing.desktopKeylineIncrement * 2.75,
        marginTop: '0.5rem',
        width: '100%'
      }
    };
  }

  componentDidMount() {
    this._chartInitialize();
  }

  componentWillUnmount() {
    this._removeDygraph();
  }

  componentDidUpdate() {
    if (!this._dygraph) {
      this._chartInitialize();
    } else {
      this._chartUpdate();
    }
  }

  componentWillUpdate() {
    if (this.props.data.length < this._previousDataSize) {
      this._removeDygraph();
    }
  }

  _removeDygraph() {
    let {model} = this.props.metaData;
    let element = ReactDOM.findDOMNode(this.refs[`chart-${model.modelId}`]);
    let range = element.getElementsByClassName(RANGE_SELECTOR_CLASS)[0];

    if (this._dygraph) {
      Dygraph.removeEvent(element, 'mouseup', this._handleMouseUp.bind(this));
      Dygraph.removeEvent(range, 'mousedown', this._handleMouseDown.bind(this));
      this._dygraph.destroy();
      this._dygraph = null;
    }
  }

  /**
   * Dygraphs Chart Initialize and Render
   */
  _chartInitialize() {
    let {data, metaData, options, resolution} = this.props;

    if (data.length < 2) return;

    let {metric, model} = metaData;
    let first = data[0][DATA_INDEX_TIME].getTime();
    let last = data[data.length - 1][DATA_INDEX_TIME].getTime();

    let element = ReactDOM.findDOMNode(this.refs[`chart-${model.modelId}`]);
    let rangeWidth = getDateWindowWidth(resolution, element);

    let rangeMin = first;
    // move chart back to last valid display position from previous viewing
    if ('viewpoint' in metric && metric.viewpoint) {
      rangeMin = metric.viewpoint;
    }
    let rangeMax = rangeMin + rangeWidth;
    if (rangeMax > last) {
      rangeMax = last;
      rangeMin = last - rangeWidth;
    }
    this._chartRange = [rangeMin, rangeMax];

    // init, render, and draw chart!
    options.labelsUTC = true;
    options.dateWindow = this._chartRange;  // update viewport of range selector
    this._previousDataSize = data.length;
    this._dygraph = new CustomDygraph(element, data, options,
                                      this.props.xScaleCalculate,
                                      this.props.yScaleCalculate);

    // after: track chart viewport position changes
    let rangeEl = element.getElementsByClassName(RANGE_SELECTOR_CLASS)[0];
    Dygraph.addEvent(rangeEl, 'mousedown', this._handleMouseDown.bind(this));
    Dygraph.addEvent(element, 'mouseup', this._handleMouseUp.bind(this));
  }

  /**
   * Dygraphs Chart Update Logic and Re-Render
   * @param {number} rangeWidthOverride - if set, overrides rangeWidth
   */
  _chartUpdate(rangeWidthOverride) {
    let {data, metaData, options, resolution} = this.props;

    if (data.length < 1) return;

    let {model, modelData} = metaData;

    let element = ReactDOM.findDOMNode(this.refs[`chart-${model.modelId}`]);
    let rangeWidth = rangeWidthOverride ||
          getDateWindowWidth(resolution, element);

    if (model.active && model.dataSize > 0) {
      // Move to rightmost model result.
      let first = data[0][DATA_INDEX_TIME].getTime();
      let lastResult = modelData.data[model.dataSize - 1];
      this._chartRange[1] = lastResult[DATA_INDEX_TIME].getTime();
      this._chartRange[0] = Math.max(first, this._chartRange[1] - rangeWidth);
      if (this._chartRange[1] - this._chartRange[0] < rangeWidth) {
        this._chartRange[1] = this._chartRange[0] + rangeWidth;
      }
    } else {
      let discrepancy = rangeWidth - (this._chartRange[1] -
                                      this._chartRange[0]);
      if (discrepancy < 0) {
        // Shrink the right side.
        this._chartRange[1] = this._chartRange[1] + discrepancy;
      } else if (discrepancy > 0) {
        // Grow the right side.
        this._chartRange[1] = Math.min(data[data.length-1][DATA_INDEX_TIME],
                                       this._chartRange[1] + discrepancy);
        discrepancy = rangeWidth - (this._chartRange[1] -
                                    this._chartRange[0]);
        if (discrepancy > 0) {
          // Grow the left side.
          this._chartRange[0] = Math.max(data[0][DATA_INDEX_TIME],
                                         this._chartRange[0] - discrepancy);
          discrepancy = rangeWidth - (this._chartRange[1] -
                                      this._chartRange[0]);
          if (discrepancy > 0) {
            // Force-grow the right side.
            this._chartRange[1] = this._chartRange[1] + discrepancy;
          }
        }
      }
    }

    // update chart
    options.dateWindow = this._chartRange;
    options.file = data;  // new data
    this._previousDataSize = data.length;
    this._dygraph.updateOptions(options);
  }

  /**
   * Overlay default Dygraphs Range Selector mousedown event handler in order
   *  to move chart viewpoint easily via point-and-click.
   * @param {Object} event - DOM `mousedown` event object
   */
  _handleMouseDown(event) {
    if (!this._dygraph) return;
    if (this.props.metaData.model.active) {
      this._jumpToNewResults = false;
    }

    let eventX = this._dygraph.eventToDomCoords(event)[0];
    let {w: canvasWidth} = this._dygraph.getArea();
    let [chartStart, chartEnd] = this._dygraph.xAxisExtremes();
    let [rangeStart, rangeEnd] = this._chartRange;
    let chartWidth = chartEnd - chartStart;
    let rangeWidth = rangeEnd - rangeStart;
    let rangeWidthHalf = rangeWidth / 2;
    let pixelFactor = eventX / canvasWidth;
    let chartFactor = pixelFactor * chartWidth;
    let ts = chartStart + chartFactor;
    let newMin = ts - rangeWidthHalf;
    let newMax = ts + rangeWidthHalf;

    // only handle click outside of range finder handle
    if (ts >= rangeStart && ts <= rangeEnd) return;

    // watch out for Range Selector hanging off edges
    if (newMin < chartStart) {
      newMin = chartStart;
      newMax = chartStart + rangeWidth;
    } else if (newMax > chartEnd) {
      newMax = chartEnd;
      newMin = chartEnd - rangeWidth;
    }

    // update chart
    this._chartRange = [newMin, newMax];
    this._chartUpdate(rangeWidth);
  }

  /**
   * Overlay default Dygraphs mouseup event handler to also store the current
   *  chart viewpoint (viewport starting UTC date stamp). This is used for
   *  both the Main Chart and the Range Selector.
   * @param {Object} event - DOM `mouseup` event object
   */
  _handleMouseUp(event) {
    if (!this._dygraph) return;
    let range = this._dygraph.xAxisRange();
    this._chartRange = range;

    // store viewpoint position
    this.context.executeAction(ChartUpdateViewpoint, {
      metricId: this.props.metaData.model.modelId,
      viewpoint: range[0] || null
    });
  }

  /**
   * React render()
   * @return {Object} - Built React component pseudo-DOM object
   */
  render() {
    let {model} = this.props.metaData;

    if (model.aggregated) {
      this._styles.root.marginTop = '1rem';  // make room for: ☑ ShowNonAgg
    }

    let classSuffix = this.props.canZoom ? 'zoom' : 'nozoom';
    return (
      <Paper
        className={`dygraph-chart-${classSuffix}`}
        ref={`chart-${model.modelId}`}
        style={this._styles.root}
        zDepth={this.props.zDepth}
      >
        <CircularProgress className="loading" size={0.5}/>
        {this._config.get('chart:loading')}
      </Paper>
    );
  }
}
