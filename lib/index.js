/* global process */

import { getStreamIterator, StreamIterable, wait, continue_ } from '@bablr/agast-helpers/stream';
import {
  printAttributes,
  printExpression,
  printNodeFlags,
  printNodeType,
  printString,
  printType,
} from '@bablr/agast-helpers/print';
import { getEmbeddedObject } from '@bablr/agast-vm-helpers/deembed';
import { buildSetStreamEffect } from '@bablr/agast-vm-helpers/builders';
import { arrayLast, freeze, freezeRecord, isFrozen, isString } from '@bablr/agast-helpers/object';
import {
  buildTag,
  parseStreamTag,
  parseTag as parseTag_,
  printTag as printTag_,
  parseTagType,
  printSource,
  tokenFlags,
  nodeFlags,
  parseString,
  parseObject,
  parseIdentifier,
  getFlagsWithGap,
  symbolName,
} from '@bablr/agast-helpers/tree';
import { isNode } from '@bablr/agast-helpers/path';
import { arrayValues, flatMap, map } from '@bablr/agast-helpers/iterable';
import { StreamTag, LiteralTag, OpenNodeTag, CloseNodeTag } from '@bablr/agast-helpers/symbols';
import { buildParser } from '@bablr/agast-helpers/parse';

let buildTagParser = (tag) => {
  switch (typeof tag) {
    case 'string':
      return { idx: 0, str: tag };
    case 'object':
      if (tag.type) {
        // TODO str is sometimes not a string!
        return { idx: 0, str: typeof tag === 'string' ? tag : printTag(tag) };
      } else {
        return tag;
      }
  }
};

export const printOpenNodeTag = (tag) => {
  if (tag?.type !== OpenNodeTag) throw new Error();

  let { flags, type, name, literalValue, attributes, selfClosing, ansiStyle } = tag.value;

  if (literalValue && !selfClosing) throw new Error();
  let selfClosingFrag = selfClosing ? ' /' : '';
  let ansiFrag = ansiStyle ? ` ${ansiStyle}` : '';
  let literalFrag = literalValue ? ` ${printString(literalValue)}` : '';

  let printedAttributes = printAttributes(attributes);
  let attributesFrag = printedAttributes ? ` ${printedAttributes}` : '';
  let typeFrag = type ? printNodeType(type) : '';
  let nameFrag = name ? printType(name) : '';

  return `<${printNodeFlags(
    flags,
  )}${typeFrag}${nameFrag}${ansiFrag}${literalFrag}${attributesFrag}${selfClosingFrag}>`;
};

export const printTag = (tag) => {
  if (tag.type === OpenNodeTag) {
    return printOpenNodeTag(tag);
  } else {
    return printTag_(tag);
  }
};

export const buildOpenNodeTag = (
  flags,
  type,
  name,
  literalValue,
  attributes,
  selfClosing,
  ansiStyle,
) => {
  if (!isString(attributes)) throw new Error();
  if (literalValue && !isString(literalValue)) throw new Error();
  if (!type && !name && !flags.token && literalValue != null) throw new Error();
  if (literalValue != null && !selfClosing) throw new Error();

  return freezeRecord({
    type: OpenNodeTag,
    value: freezeRecord({
      flags,
      name: symbolName(name),
      type: symbolName(type),
      literalValue,
      attributes,
      selfClosing,
      ansiStyle,
    }),
  });
};

export const parseANSIStyle = (input) => {
  let p = buildParser(input);
  let { str } = p;
  let chr = str[p.idx];

  let startIdx = p.idx;

  if (chr !== '\x1B') throw new Error();
  chr = str[++p.idx];

  if (chr !== '[') throw new Error();
  chr = str[++p.idx];

  while (chr && chr !== 'm') {
    while (chr >= '0' && chr <= '9') {
      chr = str[++p.idx];
    }
    if (chr === ';') {
      chr = str[++p.idx];
    } else break;
  }

  if (chr !== 'm') throw new Error();
  chr = str[++p.idx];

  let endIdx = p.idx;

  return str.slice(startIdx, endIdx);
};

export const parseOpenNodeTag = (tag) => {
  let p = buildTagParser(tag);
  let { str } = p;
  let chr = str[p.idx];

  if (chr !== '<') throw new Error();
  chr = str[++p.idx];
  let token = false;
  let hasGap = false;
  if (chr === '*') {
    chr = str[++p.idx];
    token = true;
  }
  if (chr === '$') {
    chr = str[++p.idx];
    hasGap = true;
  }

  let flags = token ? tokenFlags : nodeFlags;

  let type = null;
  let name = null;

  if (chr === '_') {
    chr = str[++p.idx];
    type = Symbol.for('_');

    if (chr === '_') {
      chr = str[++p.idx];
      type = Symbol.for('__');
    }
  }
  if (!` '"/>`.includes(chr)) {
    name = parseIdentifier(p);
    chr = str[p.idx];
  }

  while (chr === ' ') {
    chr = str[++p.idx];
  }

  let ansiStyle = null;
  if (chr === '\x1B') {
    ansiStyle = parseANSIStyle(p);
    chr = str[p.idx];

    while (chr === ' ') chr = str[++p.idx];
  }

  let literalValue = null;

  if (`'"`.includes(chr)) {
    literalValue = parseString(p);
    chr = str[p.idx];

    while (chr === ' ') chr = str[++p.idx];
  }

  let attributes = freezeRecord({});

  if (chr === '{') {
    attributes = parseObject(p);
    chr = str[p.idx];

    while (chr === ' ') chr = str[++p.idx];
  }

  let selfClosing = false;

  if (chr === '/') {
    chr = str[++p.idx];
    selfClosing = true;
  }

  if (chr === '>') {
    chr = str[++p.idx];
  }

  if (isString(tag) && p.idx !== str.length) throw new Error();

  if (hasGap) flags = getFlagsWithGap(flags);

  return buildTag(OpenNodeTag, {
    flags,
    name: symbolName(name),
    type: symbolName(type),
    literalValue,
    attributes: printExpression(attributes),
    selfClosing,
    ansiStyle,
  });
};

export const parseTag = (tag) => {
  let p = buildTagParser(tag);
  if (tag == null) return null;

  let tagType = parseTagType(tag);
  if (tagType === OpenNodeTag) {
    return parseOpenNodeTag(tag);
  } else {
    return parseTag_(tag);
  }
};

export const a = ({ 0: n }) => `${n}`;
export const a256 = ({ 0: n }) => `38;5;${n}`;
export const a256bg = ({ 0: n }) => `48;5;${n}`;

export const ansiRules = freezeRecord({
  reset: a`0`,
  bold: a`1`,
  dim: a`2`,
  italic: a`3`,
  underline: a`4`,
  overline: a`53`,
  inverse: a`7`,
  hidden: a`8`,
  strikethrough: a`9`,

  black: a`30`,
  red: a`31`,
  green: a`32`,
  yellow: a`33`,
  blue: a`34`,
  magenta: a`35`,
  cyan: a`36`,
  white: a`37`,
  orange: a256`208`,

  gray: a`90`,
  brightRed: a`91`,
  brightGreen: a`92`,
  brightYellow: a`93`,
  brightBlue: a`94`,
  brightMagenta: a`95`,
  brightCyan: a`96`,
  brightWhite: a`97`,

  bgBlack: a`40`,
  bgRed: a`41`,
  bgGreen: a`42`,
  bgYellow: a`43`,
  bgBlue: a`44`,
  bgMagenta: a`45`,
  bgCyan: a`46`,
  bgWhite: a`47`,
  bgOrange: a256bg`208`,

  bgGray: a`100`,
  bgBrightRed: a`101`,
  bgBrightGreen: a`102`,
  bgBrightYellow: a`103`,
  bgBrightBlue: a`104`,
  bgBrightMagenta: a`105`,
  bgBrightCyan: a`106`,
  bgBrightWhite: a`107`,
});

function* writeToStream(from, to) {
  let iter = getStreamIterator(from);
  let step;

  let buf = '';

  for (;;) {
    step = iter.next();
    while (step === null || step instanceof Promise) {
      if (step === null) yield continue_(), (step = iter.next());
      if (step instanceof Promise) step = yield wait(step);
    }
    if (step.done) break;

    let chr = step.value;

    buf += chr;

    if (chr === '\n') {
      if (!to.write(buf)) {
        yield wait(new Promise((resolve) => to.once('drain', resolve)));
      }
      buf = '';
    }
  }

  if (!to.write(buf)) {
    yield wait(new Promise((resolve) => to.once('drain', resolve)));
  }
}

function* __evaluate(strategy) {
  let iter = getStreamIterator(strategy());
  let step;
  let returnValue;

  const streams = [null, process.stdout, process.stderr];
  let stacks = [null, [], []];

  let stream = 1;

  for (;;) {
    step = iter.next(returnValue);
    while (step === null || step instanceof Promise) {
      if (step === null) yield continue_(), (step = iter.next());
      if (step instanceof Promise) step = yield wait(step);
    }

    if (step.done) {
      return step.value;
    }

    let tag = parseTag(step.value);

    switch (tag.type) {
      case StreamTag: {
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
        let { ansiStyle, literalValue, selfClosing } = tag.value;

        if (ansiStyle) {
          yield* writeToStream(ansiStyle, streams[stream]);

          stacks[stream].push(ansiStyle);
        } else {
          stacks[stream].push(arrayLast(stacks[stream]));
        }

        if (literalValue) {
          yield* writeToStream(literalValue, streams[stream]);
        }

        if (selfClosing) {
          stacks[stream].pop();

          yield* writeToStream('\x1b[0m', streams[stream]);

          let ansiStyle = arrayLast(stacks[stream]);
          if (ansiStyle) {
            yield* writeToStream(ansiStyle, streams[stream]);
          }
        }
        break;
      }

      case CloseNodeTag: {
        stacks[stream].pop();

        yield* writeToStream('\x1b[0m', streams[stream]);

        let ansiStyle = arrayLast(stacks[stream]);
        if (ansiStyle) {
          yield* writeToStream(ansiStyle, streams[stream]);
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

function* __writeSource(strategy, options) {
  let iter = getStreamIterator(strategy());
  let step;
  let returnValue;

  const streams = [null, process.stdout, process.stderr];
  let stacks = [null, [], []];

  let stream = 1;

  for (;;) {
    step = iter.next(returnValue);
    while (step === null || step instanceof Promise) {
      if (step === null) yield continue_(), (step = iter.next());
      if (step instanceof Promise) step = yield wait(step);
    }

    if (step.done) {
      let stack = stacks[stream];

      return step.value;
    }

    let tag = parseStreamTag(step.value);

    switch (tag.type) {
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

export const writeSource = (strategy) => {
  return new StreamIterable(__writeSource(strategy));
};
