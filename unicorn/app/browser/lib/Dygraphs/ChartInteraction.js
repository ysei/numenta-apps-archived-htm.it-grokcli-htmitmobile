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

import Dygraph from 'dygraphs';


/**
 * Dodge Dygraph bugs by disabling 2D panning.
 *
 * Aside from the "is2DPan" addition, this is the
 * Dygraph.Interaction.dragIsPanInteractionModel.
 */
export default {
  mousedown(event, g, context) {
    context.initializeMouseDown(event, g, context);
    Dygraph.Interaction.startPan(event, g, context);
  },
  mousemove(event, g, context) {
    if (context.isPanning) {
      // The Dygraphs interaction code gets really confused if you've set a y
      // valueRange rather than relying on Dygraphs to choose the y scale.
      // Panning the chart left and right often causes the y scale to jump up,
      // or to jump down, or to start panning up and down. Luckily the buggy
      // code all lives in the "is2DPan=true" case, and we only use 1D panning.
      context.is2DPan = false;
      Dygraph.Interaction.movePan(event, g, context);
    }
  },
  mouseup(event, g, context) {
    if (context.isPanning) {
      Dygraph.Interaction.endPan(event, g, context);
    }
  }
};
