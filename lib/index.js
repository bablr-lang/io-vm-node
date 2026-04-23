/* global process */

import { getStreamIterator, StreamIterable, wait } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import { getEmbeddedObject } from '@bablr/agast-vm-helpers/deembed';
import emptyStack from '@iter-tools/imm-stack';
import { buildSetStreamEffect, buildWriteEffect } from '@bablr/agast-vm-helpers/builders';
import { buildTag } from '@bablr/helpers/builders';
import { freeze, isFrozen, isString } from '@bablr/agast-helpers/object';
import { printSource } from '@bablr/agast-helpers/tree';
import { isNode } from '@bablr/agast-helpers/path';
import { arrayValues, flatMap, map } from '@bablr/agast-helpers/iterable';

const a = ({ 0: n }) => `\x1b[${n}m`;
const a256 = ({ 0: n }) => `\x1b[38;5;${n}m`;
const a256bg = ({ 0: n }) => `\x1b[48;5;${n}m`;

const ansiStyles = {
  reset: [a`0`, a`0`],
  bold: [a`1`, a`22`],
  dim: [a`2`, a`22`],
  italic: [a`3`, a`23`],
  underline: [a`4`, a`24`],
  overline: [a`53`, a`55`],
  inverse: [a`7`, a`27`],
  hidden: [a`8`, a`28`],
  strikethrough: [a`9`, a`29`],

  black: [a`30`, a`39`],
  red: [a`31`, a`39`],
  green: [a`32`, a`39`],
  yellow: [a`33`, a`39`],
  blue: [a`34`, a`39`],
  magenta: [a`35`, a`39`],
  cyan: [a`36`, a`39`],
  white: [a`37`, a`39`],
  orange: [a256`208`, a`39`],

  gray: [a`90`, a`39`],
  brightRed: [a`91`, a`39`],
  brightGreen: [a`92`, a`39`],
  brightYellow: [a`93`, a`39`],
  brightBlue: [a`94`, a`39`],
  brightMagenta: [a`95`, a`39`],
  brightCyan: [a`96`, a`39`],
  brightWhite: [a`97`, a`39`],

  bgBlack: [a`40`, a`49`],
  bgRed: [a`41`, a`49`],
  bgGreen: [a`42`, a`49`],
  bgYellow: [a`43`, a`49`],
  bgBlue: [a`44`, a`49`],
  bgMagenta: [a`45`, a`49`],
  bgCyan: [a`46`, a`49`],
  bgWhite: [a`47`, a`49`],
  bgOrange: [a256bg`208`, `49`],

  bgGray: [a`100`, a`49`],
  bgBrightRed: [a`101`, a`49`],
  bgBrightGreen: [a`102`, a`49`],
  bgBrightYellow: [a`103`, a`49`],
  bgBrightBlue: [a`104`, a`49`],
  bgBrightMagenta: [a`105`, a`49`],
  bgBrightCyan: [a`106`, a`49`],
  bgBrightWhite: [a`107`, a`49`],
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
            .map((id) => ansiStyles[id][1])
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
            [...arrayValues(stack.value.spans)]
              .map((id) => ansiStyles[id][1])
              .reverse()
              .join(''),
            streams[stream],
          );
        }

        stacks[stream] = stack = stack.push({
          spans,
        });

        if (spans.length) {
          yield* writeToStream(
            flatMap((id) => ansiStyles[id][0], arrayValues(stack.value.spans)),
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
            [...arrayValues(stackValue.spans)]
              .map((id) => ansiStyles[id][1])
              .reverse()
              .join(''),
            streams[stream],
          );
        }

        if (stack.value && stack.value.spans.length) {
          yield* writeToStream(
            flatMap((id) => ansiStyles[id][0], arrayValues(stack.value.spans)),
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
              .map((id) => ansiStyles[id][1])
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
              .map((id) => ansiStyles[id][0])
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
