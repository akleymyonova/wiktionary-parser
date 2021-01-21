/* 
    Parses wiktionary html to get parsed result of ParsedDefinitions class instance
*/

'use strict';

const CustomErrors = require('./CustomErrorEnum');
const jsdom = require('jsdom');
const jquery = require('jquery');

/// Pos (or POS) - part of speech

const LANGUAGE = 'en';

const speech = [
  'noun',
  'pronoun',
  'adjectives',
  'adjective',
  'numerals',
  'verb',
  'adverb',
  'article',
  'preposition',
  'conjunction',
  'interjection',
  'abbreviation'
];

class DictionaryEntry {
  constructor(speech) {
    this.speech = speech;
    this.lines = [];
  }

  addLine(definition, examples) {
    this.lines.push({ define: definition, examples });
  }
}

class ParsedDefinitions {
  constructor(word) {
    this.word = word;
    this.extendable = false;
    this.transcription = '';
    this.language = LANGUAGE;
    this.etymologyBlocks = [];
    this.shortView = [];
  }

  addTranscription(transcription) {
    this.transcription = transcription;
  }

  addEtymology() {
    this.etymologyBlocks.push([]);
  }

  addDictionaryEntry(dictionaryEntry) {
    const lastIndex = this.etymologyBlocks.length - 1;
    this.etymologyBlocks[lastIndex].push(dictionaryEntry);
  }

  fillShortView() {
    if (!this.etymologyBlocks.length || !this.etymologyBlocks[0].length) {
      return;
    }
    const shortView = this.etymologyBlocks[0][0];
    shortView.lines = shortView.lines.splice(0, 1);
    this.shortView = [[shortView]];
    this.extendable = this._isExtandable();
  }

  _isExtandable() {
    return (
      this.etymologyBlocks.length > 1 ||
      this.etymologyBlocks[0].length > 1 ||
      this.etymologyBlocks[0][0].lines.length > 1
    );
  }
}

class WiktionaryParser {
  constructor(req) {
    this.cancelRequest = req.aborted;
    req.on('close', err => {
      this.cancelRequest = true;
    });
    this.window = new jsdom.JSDOM().window;
    this.$ = jquery(this.window);
    this.parsedDefinitions = null;
    this.posElementIds = [];
  }

  getParsedResult() {
    return this.parsedDefinitions;
  }

  parse(word, rawDefinition) {
    this.appendDefinition(rawDefinition);
    if (this.cancelRequest) {
      return;
    }
    this.parsedDefinitions = new ParsedDefinitions(word);
    this.extractTranscription();
    if (this.cancelRequest) {
      return;
    }
    this.extractDefinitions();
    if (this.cancelRequest) {
      return;
    }
    this.parsedDefinitions.fillShortView();
  }

  appendDefinition(rawDefinition) {
    this.$('body').empty();
    this.$('body').append(rawDefinition);
  }

  parseToc() {
    const toc = this.$('.toc');
    toc.find('.toclevel-1').each((i, elem) => {
      if (!this.$(elem).children('[href="#English"]').length) {
        return;
      }
      const tocLevel = this.$(elem).find('.toclevel-2');
      this._processTocLevel(tocLevel);
    });
  }

  _processTocLevel(tocLevel) {
    tocLevel.each((i, elem) => {
      if (this.$(elem).children('[href*="Etymology"]').length) {
        const nextLevel = this.$(elem).children('ul');
        this.posElementIds.push({});
        this._processTocLevel(nextLevel.children());
        return;
      }
      const item = this.$(elem)
        .find('a')
        .first();
      const itemText = item.find('.toctext').text();
      if (speech.includes(itemText.toLowerCase())) {
        if (!this.posElementIds.length) {
          this.posElementIds.push({});
        }
        const lastIndex = this.posElementIds.length - 1;
        this.posElementIds[lastIndex][itemText] = item.attr('href');
      }
    });
  }

  extractTranscription() {
    const pronunciationHeading = this.$('#Pronunciation');
    if (!pronunciationHeading.length || this.cancelRequest) {
      return;
    }
    const transcription = pronunciationHeading
      .parent()
      .next()
      .find('.IPA')
      .first()
      .text();
    this.parsedDefinitions.addTranscription(transcription);
  }

  extractDefinitions() {
    this.parseToc();
    if (this.cancelRequest) {
      return;
    }
    for (let value of this.posElementIds) {
      if (this.cancelRequest) {
        return;
      }
      this.parsedDefinitions.addEtymology();
      for (let [pos, id] of Object.entries(value)) {
        if (this.cancelRequest) {
          return;
        }
        const dictionaryEntry = this.extractDictionaryEntry(pos, id);
        this.parsedDefinitions.addDictionaryEntry(dictionaryEntry);
      }
    }
  }

  extractDictionaryEntry(pos, elementId) {
    const dictionaryEntry = new DictionaryEntry(pos);
    const definitionsList = this._findDefinitionsList(elementId);
    definitionsList.children().each((i, elem) => {
      const text = this.$(elem)
        .text()
        .split('\n');
      const def = text[0];
      if (!def) {
        return;
      }
      const examples = text.slice(1, 2);
      dictionaryEntry.addLine(def, examples);
    });
    return dictionaryEntry;
  }

  _findDefinitionsList(elementId) {
    return this.$(elementId)
      .parent()
      .nextAll('ol')
      .first();
  }
}

function parse(word, rawDefinition, req) {
  const wiktionaryParser = new WiktionaryParser(req);
  if (wiktionaryParser.cancelRequest) {
    return CustomErrors.CANCELLED_REQUEST;
  }
  wiktionaryParser.parse(word, rawDefinition);
  return wiktionaryParser.cancelRequest
    ? CustomErrors.CANCELLED_REQUEST
    : wiktionaryParser.getParsedResult();
}

module.exports = {
  parse
};
