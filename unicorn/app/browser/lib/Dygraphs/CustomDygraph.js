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
 * Add a feature to Dygraphs: allow custom y scaling on each draw.
 *
 * @param {Element} element - param for Dygraph constructor
 * @param {Array} data - param for Dygraph constructor
 * @param {Object} options - param for Dygraph constructor
 * @param {Function} yAxisRangeCalculate - takes a dygraph
 *                                         returns a [min, max] y axis range
 */
function CustomDygraph(element, data, options, yAxisRangeCalculate) {
  // This code uses prototype syntax rather than class syntax because it needs
  // to set `this.yAxisRangeCalculate_` before calling the Dygraph constructor,
  // which isn't possible with class syntax.
  this.yAxisRangeCalculate_ = yAxisRangeCalculate;
  Dygraph.call(this, element, data, options);
}

CustomDygraph.prototype = Object.create(Dygraph.prototype);
CustomDygraph.prototype.drawGraph_ = function () {
  let yExtentAdjusted = this.yAxisRangeCalculate_(this);

  // Change it directly. Using `updateOptions` won't work. If it causes a
  // redraw, there's a stack overflow. With blockRedraw=true, it doesn't update
  // the axes. Avoid using a valueRange in the options if you're using a
  // CustomDygraph.
  this.axes_[0].valueRange = yExtentAdjusted;
  this.axes_[0].computedValueRange = yExtentAdjusted;
  this.axes_[0].extremeRange = yExtentAdjusted.map(
    (v) => v - yExtentAdjusted[0]
  );

  Dygraph.prototype.drawGraph_.call(this);
};

export default CustomDygraph;
