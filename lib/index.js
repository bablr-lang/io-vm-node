/* global process */

import { getStreamIterator, StreamIterable, wait, continue_ } from '@bablr/agast-helpers/stream';
import {
  printAttributes,
  printNodeFlags,
  printNodeType,
  printString,
  printType,
} from '@bablr/agast-helpers/print';
import {
  arrayLast,
  freeze,
  freezeRecord,
  isArray,
  isFrozen,
  isString,
} from '@bablr/agast-helpers/object';
import {
  parseStreamTag as parseStreamTag_,
  printTag as printTag_,
  parseStreamTagType,
  parseString,
  parseObject,
  parseIdentifier,
  symbolName,
  parseNodeFlags,
} from '@bablr/agast-helpers/tree';
import { arrayValues } from '@bablr/agast-helpers/iterable';
import { MuxerTag, LiteralTag, OpenNodeTag, CloseNodeTag } from '@bablr/agast-helpers/symbols';
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

  let { flags, type, name, literalValue, attributes, selfClosing, displayAttributes } = tag.value;

  if (literalValue && !selfClosing) throw new Error();
  let selfClosingFrag = selfClosing ? ' /' : '';
  let ansiFrag = displayAttributes ? ` ${displayAttributes}` : '';
  let literalFrag = literalValue ? ` ${printString(literalValue)}` : '';
  let flagsFrag = printNodeFlags(flags);
  let printedAttributes = printAttributes(attributes);
  let attributesFrag = printedAttributes ? ` ${printedAttributes}` : '';
  let typeFrag = type ? printNodeType(type) : '';
  let nameFrag = name ? printType(name) : '';

  return `<${flagsFrag}${typeFrag}${nameFrag}${ansiFrag}${literalFrag}${attributesFrag}${selfClosingFrag}>`;
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
  displayAttributes,
) => {
  if (!isString(attributes)) throw new Error();
  if (literalValue && !isString(literalValue)) throw new Error();
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
      displayAttributes,
    }),
  });
};

let parseUnsignedInteger = (input, digits = Infinity) => {
  let p = buildParser(input);
  let { str } = p;
  let chr = str[p.idx];

  let chrs = [];
  for (let i = 0; i < digits; i++) {
    if (chr && chr >= '0' && chr <= '9') {
      chrs.push(chr);
      chr = str[++p.idx];
    } else {
      break;
    }
  }

  return parseInt(chrs.join(''), 10);
};

let Reset = 'Reset';
let Color = 'Color';
let Intensity = 'Intensity';
let Italic = 'Italic';
let Underline = 'Underline';
let Inverted = 'Inverted';
let Blink = 'Blink';

let inRange = (value, lower, upper) => {
  return value >= lower && value <= upper;
};

let endsAttribute = (chr) => chr === ';' || chr === 'm';

export const parseANSIDisplayAttribute = (input) => {
  let p = buildParser(input);
  let { str } = p;
  let chr = str[p.idx];

  let code = parseUnsignedInteger(p, 4);
  chr = str[p.idx];

  let sep;
  if (chr === ';') {
    sep = chr;
    chr = str[++p.idx];
  }

  let displayAttribute;

  if (code === 38 || code === 48) {
    if (!sep) throw new Error();

    let nextCode = parseUnsignedInteger(p, 1);
    chr = str[p.idx];

    if (!endsAttribute(chr)) throw new Error();
    chr = str[++p.idx];

    if (nextCode === 5) {
      displayAttribute = {
        type: Color,
        value: freezeRecord({ code, value: -parseUnsignedInteger(p, 4) }),
      };
      chr = str[p.idx];
      if (!endsAttribute(chr)) throw new Error();
    } else if (nextCode === 2) {
      let rgb = [];
      rgb[0] = parseUnsignedInteger(p, 3);
      if (chr !== ';') throw new Error();
      chr = str[++p.idx];
      rgb[1] = parseUnsignedInteger(p, 3);
      if (chr !== ';') throw new Error();
      chr = str[++p.idx];
      rgb[2] = parseUnsignedInteger(p, 3);
      if (!endsAttribute(chr)) throw new Error();
      chr = str[++p.idx];
      displayAttribute = { type: Color, value: freezeRecord({ code, value: freezeRecord(rgb) }) };
    } else {
      throw new Error();
    }
  } else if (
    inRange(code, 30, 37) ||
    inRange(code, 40, 47) ||
    inRange(code, 90, 97) ||
    inRange(code, 100, 107)
  ) {
    displayAttribute = { type: Color, value: freezeRecord({ code, value: code }) };
  } else if (code === 0) {
    displayAttribute = { type: Reset, value: code };
  } else if (code === 1 || code === 2) {
    displayAttribute = { type: Intensity, value: code };
  } else if (code === 3 || code === 20) {
    displayAttribute = { type: Italic, value: code };
  } else if (code === 4 || code === 21) {
    displayAttribute = { type: Underline, value: code };
  } else if (code === 5) {
    displayAttribute = { type: Blink, value: code };
  } else if (code === 7) {
    displayAttribute = { type: Inverted, value: code };
  } else {
    throw new Error();
  }

  return freezeRecord(displayAttribute);
};

export const parseANSIStyle = (input) => {
  let p = buildParser(input);
  let { str } = p;
  let chr = str[p.idx];
  let displayAttributes = [];

  if (chr !== '\x1B') throw new Error();
  chr = str[++p.idx];

  if (chr !== '[') throw new Error();
  chr = str[++p.idx];

  while (chr && chr !== 'm') {
    displayAttributes.push(parseANSIDisplayAttribute(p));
    chr = str[p.idx];
    if (str[p.idx - 1] !== ';') break;
  }

  if (chr !== 'm') throw new Error();
  chr = str[++p.idx];

  return freezeRecord(displayAttributes);
};

export const printDisplayAttribute = (displayAttribute) => {
  if (displayAttribute.type === 'Color') {
    let { code, value } = displayAttribute.value;
    if (typeof value === 'number') {
      if (value > 0) {
        return a(code);
      } else {
        return a(code) + ';' + a256(-value);
      }
    } else if (isArray(value)) {
      return a(code) + ';' + truecolor(value[0], value[1], value[2]);
    } else {
      throw new Error();
    }
  } else {
    return a(displayAttribute.value);
  }
};

export const printDisplayAttributes = (displayAttributes) => {
  let str = '';
  let first = true;
  for (let displayAttribute of arrayValues(displayAttributes)) {
    if (!first) str += ';';
    str += printDisplayAttribute(displayAttribute);
    first = false;
  }
  return str;
};

export const printAnsiStyle = (displayAttributes) => {
  return `\x1b[${printDisplayAttributes(displayAttributes)}m`;
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

  let flags = parseNodeFlags(p);
  chr = str[p.idx];

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

  let displayAttributes = null;
  if (chr === '\x1B') {
    displayAttributes = parseANSIStyle(p);
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

  return buildOpenNodeTag(
    flags,
    symbolName(name),
    symbolName(type),
    literalValue,
    printAttributes({ ...attributes, ansiDisplay: displayAttributes }),
    selfClosing,
  );
};

export const parseTag = (tag) => {
  let p = buildTagParser(tag);
  if (tag == null) return null;

  let tagType = parseStreamTagType(tag);
  if (tagType === OpenNodeTag) {
    return parseOpenNodeTag(tag);
  } else {
    return parseStreamTag_(tag);
  }
};

export const a = (arg, ...exprs) => {
  return isArray(arg) ? String.raw(arg, ...exprs) : '' + arg;
};
export const a256 = (arg, ...exprs) => {
  let n = isArray(arg) ? String.raw(arg, ...exprs) : '' + arg;
  return `5;${n}`;
};
export const truecolor = (r, g, b) => `2;${r};${g};${b}`;

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
  orange: a`38;${a256`208`}`,

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
  bgOrange: a`48;${a256`208`}`,

  bgGray: a`100`,
  bgBrightRed: a`101`,
  bgBrightGreen: a`102`,
  bgBrightYellow: a`103`,
  bgBrightBlue: a`104`,
  bgBrightMagenta: a`105`,
  bgBrightCyan: a`106`,
  bgBrightWhite: a`107`,
});

let buildTypes = () => ({
  Color: null,
  Intensity: null,
  Italic: null,
  Underline: null,
  Inverted: null,
  Blink: null,
});

export const normalizeAnsiStyles = (styles) => {
  let types = buildTypes();

  for (let style of styles) {
    if (style.type === 'Reset') {
      types = buildTypes();
    } else {
      types[style.type] = style;
    }
  }
  return Object.values(types).filter((_) => _);
};

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
      case MuxerTag: {
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
        let { literalValue, selfClosing, attributes } = tag.value;
        let { ansiDisplay: displayAttributes } = parseObject(attributes);

        let normalizedDisplayAttributes = !stacks[stream].length
          ? displayAttributes || []
          : normalizeAnsiStyles([
              ...arrayValues(arrayLast(stacks[stream])),
              ...arrayValues(displayAttributes || []),
            ]);
        yield* writeToStream(printAnsiStyle(normalizedDisplayAttributes), streams[stream]);

        stacks[stream].push(normalizedDisplayAttributes);

        if (literalValue) {
          yield* writeToStream(literalValue, streams[stream]);
        }

        if (selfClosing) {
          stacks[stream].pop();

          yield* writeToStream('\x1b[0m', streams[stream]);

          let displayAttributes = arrayLast(stacks[stream]);
          if (displayAttributes) {
            yield* writeToStream(printAnsiStyle(displayAttributes), streams[stream]);
          }
        }
        break;
      }

      case CloseNodeTag: {
        stacks[stream].pop();

        yield* writeToStream('\x1b[0m', streams[stream]);

        let displayAttributes = arrayLast(stacks[stream]);
        if (displayAttributes) {
          yield* writeToStream(printAnsiStyle(displayAttributes), streams[stream]);
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
