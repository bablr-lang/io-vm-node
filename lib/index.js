/* global process */

import { getStreamIterator, StreamIterable, wait } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import { getEmbeddedObject } from '@bablr/agast-vm-helpers/deembed';
import emptyStack from '@iter-tools/imm-stack';
import ansiStyles_ from 'ansi-styles';
import { buildSetStreamEffect, buildWriteEffect } from '@bablr/agast-vm-helpers/builders';
import { buildTag } from '@bablr/helpers/builders';
import { freeze, isFrozen, isString } from '@bablr/agast-helpers/object';
import { printSource } from '@bablr/agast-helpers/tree';
import { isNode } from '@bablr/agast-helpers/path';

const ansiStyles = {
  ...ansiStyles_,
  orange: {
    open: ansiStyles_.color.ansi256(208),
    close: ansiStyles_.color.close,
  },
};

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

function* __print(instrs) {
  let iter = getStreamIterator(instrs);
  let step;

  let stream = 1;

  let returnValue = undefined;

  for (;;) {
    step = iter.next(returnValue);
    if (step instanceof Promise) step = yield wait(step);
    if (step.done) break;

    let instr = step.value;

    if (instr.type === 'Effect') {
      if (stream !== 2) {
        stream = 2;
        yield buildSetStreamEffect(stream);
      }
      const effect = instr.value;

      const { verb } = effect;

      switch (verb) {
        case 'write': {
          yield instr;
          break;
        }
        default:
          throw new Error();
      }
    } else {
      if (stream !== 1) {
        stream = 1;
        yield buildSetStreamEffect(stream);
      }

      yield buildWriteEffect(isNode(instr) ? instr : buildTag(instr));
    }
  }
}

export const print = (instrs) => new StreamIterable(__print(instrs));

function* __evaluate(strategy, options) {
  let { printEnhancer } = options;
  let print_ = print;

  if (printEnhancer) {
    print_ = printEnhancer(print_);
  }

  let iter = getStreamIterator(print_(strategy()));
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
      if (stack.size) {
        yield* writeToStream(
          stack.value.spans
            .map((id) => ansiStyles[id].close)
            .reverse()
            .join(''),
          process.stdout,
        );
      }

      return step.value;
    }

    let instr = step.value;

    let effect = instr.value;

    let { verb, value } = effect;

    switch (verb) {
      case 'write': {
        let { value } = getEmbeddedObject(effect.value);

        // yield* writeToStream(
        //   escapeAnsi(isString(value) ? value : printSource(value)),
        //   streams[stream],
        // );

        yield* writeToStream(isString(value) ? value : printSource(value), streams[stream]);
        break;
      }

      case 'ansi-push': {
        let { spans } = getEmbeddedObject(value);

        let stack = stacks[stream];

        if (!spans?.length) {
          spans = stack.value?.spans || [];
        }

        if (stack.value?.spans.length) {
          yield* writeToStream(
            stack.value.spans
              .map((id) => ansiStyles[id].close)
              .reverse()
              .join(''),
            streams[stream],
          );
        }

        stacks[stream] = stack = stack.push({
          spans,
        });

        if (spans.length) {
          // TODO is this safe? Probably not.
          // Who knows what is on the ansiStyles prototype chain...
          yield* writeToStream(
            stack.value.spans.map((id) => ansiStyles[id].open).join(''),
            streams[stream],
          );
        }
        break;
      }

      case 'ansi-pop': {
        let stack = stacks[stream];

        if (!stack.size) throw new Error('cannot pop: stack empty');

        const stackValue = stack.value;

        stacks[stream] = stack = stack.pop();

        if (stackValue.spans.length) {
          yield* writeToStream(
            stackValue.spans
              .map((id) => ansiStyles[id].close)
              .reverse()
              .join(''),
            streams[stream],
          );
        }

        if (stack.value && stack.value.spans.length) {
          yield* writeToStream(
            stack.value.spans.map((id) => ansiStyles[id].open).join(''),
            streams[stream],
          );
        }
        break;
      }

      case 'set-stream': {
        if (value !== 1 && value !== 2) throw new Error();

        let streamChanged = stream !== value;

        let stack = stacks[stream];
        if (stack.size && streamChanged) {
          yield* writeToStream(
            stack.value.spans
              .map((id) => ansiStyles[id].close)
              .reverse()
              .join(''),
            streams[stream],
          );
        }

        stream = value;
        stack = stacks[stream];

        if (stack.size && streamChanged) {
          yield* writeToStream(
            stack.value.spans
              .map((id) => ansiStyles[id].open)
              .reverse()
              .join(''),
            streams[stream],
          );
        }

        if (streamChanged && stream === 2) {
          yield* writeToStream('\n', streams[stream]);
        }

        returnValue = value;
        break;
      }

      default: {
        throw new Error(`Unexpected call of {type: ${printExpression(verb)}}`);
      }
    }
  }
}

export const evaluate = (strategy, options = freeze({})) => {
  if (!isFrozen(options)) throw new Error();
  return new StreamIterable(__evaluate(strategy, options));
};
