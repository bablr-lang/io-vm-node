/* global process */

import { getStreamIterator, StreamIterable, wait } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import { getEmbeddedObject } from '@bablr/agast-vm-helpers/deembed';
import emptyStack from '@iter-tools/imm-stack';
import { buildSetStreamEffect } from '@bablr/agast-vm-helpers/builders';
import { freeze, isFrozen, isString } from '@bablr/agast-helpers/object';
import { buildTag, parseIOTag, printSource } from '@bablr/agast-helpers/tree';
import { isNode } from '@bablr/agast-helpers/path';
import { arrayValues, flatMap, map } from '@bablr/agast-helpers/iterable';
import { IOStreamOpenTag, LiteralTag, OpenNodeTag } from '@bablr/agast-helpers/symbols';

function* writeToStream(from, to) {
  let iter = getStreamIterator(from);
  let step;

  let buf = '';

  for (;;) {
    step = iter.next();
    if (step instanceof Promise) step = yield wait(step);
    if (step.done) break;

    let chr = step.value;

    buf += chr;

    if (chr === '\n') {
      if (!to.write(buf)) {
        yield new Promise((resolve) => to.once('drain', resolve));
      }
      buf = '';
    }
  }

  if (!to.write(buf)) {
    yield new Promise((resolve) => to.once('drain', resolve));
  }
}

function* __evaluate(strategy, options) {
  let iter = getStreamIterator(strategy());
  let step;
  let returnValue;

  const streams = [null, process.stdout, process.stderr];
  let stacks = [null, emptyStack, emptyStack];

  let stream = 1;

  for (;;) {
    step = iter.next(returnValue);
    if (step instanceof Promise) step = yield wait(step);

    if (step.done) {
      let stack = stacks[stream];

      return step.value;
    }

    let tag = parseIOTag(step.value);

    switch (tag.type) {
      case IOStreamOpenTag: {
        let { stream: value } = tag.value;
        if (stream !== 1 && stream !== 2) throw new Error();

        let streamChanged = stream !== value;

        let stack = stacks[stream];

        stream = value;
        stack = stacks[stream];
        break;
      }

      case LiteralTag: {
        yield* writeToStream(tag.value, streams[stream]);
        break;
      }

      case OpenNodeTag: {
        if (tag.value.literalValue) {
          yield* writeToStream(tag.value.literalValue, streams[stream]);
        }
        break;
      }
    }
  }
}

export const evaluate = (strategy, options = freeze({})) => {
  if (!isFrozen(options)) throw new Error();
  return new StreamIterable(__evaluate(strategy, options));
};
