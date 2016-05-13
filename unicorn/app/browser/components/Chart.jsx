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
import {DATA_FIELD_INDEX} from '../lib/Constants';

const {DATA_INDEX_TIME} = DATA_FIELD_INDEX;
const RANGE_SELECTOR_CLASS = 'dygraph-rangesel-fgcanvas';


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
    this._scrollLock = true;
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
    this._chartInitalize();
  }

  componentWillUnmount() {
    this._removeDygraph();
  }

  componentDidUpdate() {
    if (!this._dygraph) {
      this._chartInitalize();
    } else {
      this._chartUpdate(true);
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
   * DyGrpahs Chart Initalize and Render
   */
  _chartInitalize() {
    let {data, metaData, options} = this.props;

    if (data.length < 2) return;

    let {metric, model, displayPointCount} = metaData;
    let element = ReactDOM.findDOMNode(this.refs[`chart-${model.modelId}`]);
    let first = data[0][DATA_INDEX_TIME].getTime();
    let last = data[data.length - 1][DATA_INDEX_TIME].getTime();
    let rangeEl, unit;
    if (model.ran) {
      unit = (last - first) / model.dataSize;
    } else {
      unit = (last - first) / metric.dataSize;
    }
    let rangeWidth = unit * displayPointCount;

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
      this.props.yScaleCalculate);

    // after: track chart viewport position changes
    rangeEl = element.getElementsByClassName(RANGE_SELECTOR_CLASS)[0];
    Dygraph.addEvent(rangeEl, 'mousedown', this._handleMouseDown.bind(this));
    Dygraph.addEvent(element, 'mouseup', this._handleMouseUp.bind(this));
  }

  /**
   * DyGraphs Chart Update Logic and Re-Render
   * @param {boolean} resetZoom Whether or not to reset the zoom level
   */
  _chartUpdate(resetZoom) {
    let {data, metaData, options} = this.props;

    if (data.length < 1) return;

    let {model,  metric, displayPointCount} = metaData;
    let modelIndex = Math.abs(model.dataSize - 1);
    let first = data[0][DATA_INDEX_TIME].getTime();
    let last = data[data.length - 1][DATA_INDEX_TIME].getTime();


    let [rangeMin, rangeMax] = this._chartRange;

    let unit;
    if (model.ran) {
      unit = (last - first) / model.dataSize;
    } else {
      unit = (last - first) / metric.dataSize;
    }

    let rangeWidth = unit * displayPointCount;
    if (resetZoom) {
      rangeMax = rangeMin + rangeWidth;
      if (rangeMax > last) {
        rangeMax = last;
        rangeMin = last - rangeWidth;
      }
    }

    if (model.active && this._scrollLock) {
      rangeMax = data[modelIndex][DATA_INDEX_TIME].getTime();
      rangeMin = rangeMax - rangeWidth;
      if (rangeMin < first) {
        rangeMin = first;
        rangeMax = rangeMin + rangeWidth;
      }
    }

    this._chartRange = [rangeMin, rangeMax];

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
    this._scrollLock = false;

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
    this._chartUpdate(false);
  }

  /**
   * Overlay default Dygraphs mouseup event handler to also store the current
   *  chart viewpoint (viewport starting UTC date stamp). This is used for
   *  both the Main Chart and the Range Selector.
   * @param {Object} event - DOM `mouseup` event object
   */
  _handleMouseUp(event) {
    if (!this._dygraph) return;
    this._scrollLock = false;
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
