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

import AdvancedSettings from './AdvancedSettings'
import CircularProgress from 'material-ui/lib/circular-progress';
import connectToStores from 'fluxible-addons-react/connectToStores';
import Dialog from 'material-ui/lib/dialog';
import FlatButton from 'material-ui/lib/flat-button';
import path from 'path';
import RaisedButton from 'material-ui/lib/raised-button';
import IconButton from 'material-ui/lib/icon-button';
import IconClose from 'material-ui/lib/svg-icons/hardware/keyboard-arrow-down';
import IconOpen from 'material-ui/lib/svg-icons/hardware/keyboard-arrow-up';
import React from 'react';


import ChartUpdateViewpoint from '../actions/ChartUpdateViewpoint';
import CreateModelStore from '../stores/CreateModelStore';
import StartModelAction from '../actions/StartModel';
import {trims} from '../../common/common-utils';


/**
 * "Create Model" Dialog
 */
@connectToStores([CreateModelStore], (context) => ({
  fileName: context.getStore(CreateModelStore).fileName,
  inputOpts: context.getStore(CreateModelStore).inputOpts,
  metricId: context.getStore(CreateModelStore).metricId,
  metricName: context.getStore(CreateModelStore).metricName,
  modelRunnerParams: context.getStore(CreateModelStore).modelRunnerParams(),
  recommendAgg: context.getStore(CreateModelStore).recommendAggregation(),
  aggregateData: context.getStore(CreateModelStore).aggregateData
}))
export default class CreateModelDialog extends React.Component {

  static contextTypes = {
    executeAction: React.PropTypes.func,
    getConfigClient: React.PropTypes.func,
    getStore: React.PropTypes.func,
    muiTheme: React.PropTypes.object
  };

  constructor(props, context) {
    super(props, context);
    this._config = this.context.getConfigClient();
    this.state = {
      progress: true,
      showAdvanced: false
    };

    let muiTheme = this.context.muiTheme;
    this._styles = {
      agg: {
        marginRight: '1rem'
      },
      loading: {
        left: 0,
        marginRight: 10,
        position: 'relative',
        top: 16
      },
      advancedButton: {
        display: 'inline-block',
        verticalAlign: 'middle',
        color: muiTheme.rawTheme.palette.primary1Color,
        fontSize: 13,
        fontWeight: muiTheme.rawTheme.font.weight.normal,
        textTransform: 'none'
      },
      toggle: {
        padding: '12px 0',
        width: '30px'
      },
      toggleIcon: {
        fill: muiTheme.rawTheme.palette.primary1Color
      }
    };
  }

  _cancelAnalysis() {
    this.props.dismiss();
  }

  _startModel(payload) {
    // reset chart viewpoint so we can scroll with new data again
    this.context.executeAction(ChartUpdateViewpoint, {
      metricId: payload.metricId,
      viewpoint: null
    });

    this.props.dismiss();

    this.context.executeAction(StartModelAction, payload);
  }

  _handleAdvancedOptions() {
    this.setState({showAdvanced: !this.state.showAdvanced});
  }

  componentDidMount() {
    // Show progress for at least 4 secs
    setTimeout(() => this.setState({progress: false}), 4000);
  }

  render() {
    let {fileName, inputOpts, metricId, metricName, modelRunnerParams,
          recommendAgg, aggregateData, open} = this.props;
    let body = null;
    let actions = [];
    let message = this._config.get('dialog:model:create:title');
    let title = trims(
                  message.replace('%s',
                                  `${metricName} (${path.basename(fileName)})`)
                );

    if (modelRunnerParams && !this.state.progress) {
      let modelRunnerPayload = {
        metricId,
        inputOpts,
        modelOpts: modelRunnerParams.modelInfo,
        aggOpts: aggregateData ? modelRunnerParams.aggInfo : {}
      };

      let AdvancedSection, toggleIcon;
      
      // choose file visibility toggle icon
      if (this.state.showAdvanced) {
        toggleIcon = (<IconOpen />);
        AdvancedSection = (<AdvancedSettings
                              aggregateData={aggregateData}
                              modelRunnerParams={modelRunnerParams}
                           />);
      } else {
        toggleIcon = (<IconClose />);
        AdvancedSection = (<div></div>);
      }

      let description = '';
      if (recommendAgg) {
        description = this._config.get('dialog:model:create:recommendAggregate')
      } else {
        description = this._config.get('dialog:model:create:recommendRaw')
      }

      body = (
        <div>
          {description}
          {AdvancedSection}
        </div>
      );

      actions.push(
        <FlatButton
          label={this._config.get('dialog:model:create:advanced:buttonText')}
          onTouchTap={this._handleAdvancedOptions.bind(this)}
          linkButton={true}
          secondary={true}
          style={this._styles.advancedButton}
          icon={<IconButton style={this._styles.toggle}
                            iconStyle={this._styles.toggleIcon}
                >
                  {toggleIcon}
                </IconButton>}
        />
      );
      actions.push(
        <RaisedButton
          label={this._config.get('button:cancel')}
          onTouchTap={this._cancelAnalysis.bind(this)}
          style={this._styles.agg}
        />
      );
      actions.push(
        <RaisedButton
          label={this._config.get('button:analyze')}
          onTouchTap={this._startModel.bind(this, modelRunnerPayload)}
          primary={true}
          style={this._styles.agg}
          />
      );
    } else {
      body = (
        <div>
          <CircularProgress
            className="loading"
            size={0.5}
            style={this._styles.loading}
            />
          {this._config.get('dialog:model:create:loading')}
        </div>
      );
    }

    return (
      <Dialog actions={actions} open={open} title={title}>
        {body}
      </Dialog>
    );
  }
}
