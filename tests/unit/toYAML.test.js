const { toYAML } = require('../../index.js');

describe('toYAML', () => {
  describe('primitives', () => {
    test('null → "null"', () => {
      expect(toYAML(null)).toBe('null');
    });

    test('undefined → "null"', () => {
      expect(toYAML(undefined)).toBe('null');
    });

    test('true → "true"', () => {
      expect(toYAML(true)).toBe('true');
    });

    test('false → "false"', () => {
      expect(toYAML(false)).toBe('false');
    });

    test('number → string of number', () => {
      expect(toYAML(42)).toBe('42');
      expect(toYAML(3.14)).toBe('3.14');
    });
  });

  describe('strings', () => {
    test('plain string passes through unquoted', () => {
      expect(toYAML('hello')).toBe('hello');
      expect(toYAML('University of Porto')).toBe('University of Porto');
    });

    test('string starting with digit gets JSON.stringify\'d', () => {
      expect(toYAML('2022-07')).toBe('"2022-07"');
      expect(toYAML('1st place')).toBe('"1st place"');
    });

    test('string containing colon gets JSON.stringify\'d', () => {
      expect(toYAML('key: value')).toBe('"key: value"');
      expect(toYAML('http://example.com')).toBe('"http://example.com"');
    });

    test('string containing # gets JSON.stringify\'d', () => {
      expect(toYAML('item # 1')).toBe('"item # 1"');
    });

    test('string containing single quote gets JSON.stringify\'d', () => {
      expect(toYAML("it's fine")).toBe('"it\'s fine"');
    });

    test('string containing double quote gets JSON.stringify\'d', () => {
      expect(toYAML('say "hello"')).toBe('"say \\"hello\\""');
    });

    test('string with newline gets JSON.stringify\'d', () => {
      expect(toYAML('line1\nline2')).toBe('"line1\\nline2"');
    });

    test('empty string gets JSON.stringify\'d', () => {
      expect(toYAML('')).toBe('""');
    });

    test('"true" string gets JSON.stringify\'d', () => {
      expect(toYAML('true')).toBe('"true"');
    });

    test('"false" string gets JSON.stringify\'d', () => {
      expect(toYAML('false')).toBe('"false"');
    });

    test('"null" string gets JSON.stringify\'d', () => {
      expect(toYAML('null')).toBe('"null"');
    });

    test('string starting with @ gets JSON.stringify\'d', () => {
      expect(toYAML('@mention')).toBe('"@mention"');
    });

    test('string starting with * gets JSON.stringify\'d', () => {
      expect(toYAML('*bold*')).toBe('"*bold*"');
    });

    test('string starting with { gets JSON.stringify\'d', () => {
      expect(toYAML('{key: val}')).toBe('"{key: val}"');
    });

    test('string starting with [ gets JSON.stringify\'d', () => {
      expect(toYAML('[item]')).toBe('"[item]"');
    });
  });

  describe('arrays', () => {
    test('empty array → "[]"', () => {
      expect(toYAML([])).toBe('[]');
    });

    test('array of strings → "- item" lines', () => {
      expect(toYAML(['a', 'b', 'c'])).toBe('- a\n- b\n- c');
    });

    test('array of numbers → "- n" lines', () => {
      expect(toYAML([1, 2])).toBe('- 1\n- 2');
    });

    test('array of objects → proper YAML list syntax', () => {
      const result = toYAML([{ name: 'Alice', age: 30 }]);
      expect(result).toContain('- name: Alice');
      expect(result).toContain('age: 30');
    });

    test('array of objects with nested objects', () => {
      const result = toYAML([{ title: 'Prof. Alice', affiliation: null }]);
      // null value in nested object is omitted
      expect(result).toContain('- title: Prof. Alice');
    });

    test('array of empty objects → "- {}"', () => {
      expect(toYAML([{}])).toBe('- {}');
    });

    test('indent parameter applied to array items', () => {
      const result = toYAML(['x'], 1);
      expect(result).toBe('  - x');
    });
  });

  describe('objects', () => {
    test('empty object → "{}"', () => {
      expect(toYAML({})).toBe('{}');
    });

    test('simple key-value pairs', () => {
      const result = toYAML({ name: 'Alice', age: 30 });
      expect(result).toContain('name: Alice');
      expect(result).toContain('age: 30');
    });

    test('null values are omitted', () => {
      const result = toYAML({ name: 'Alice', bio: null });
      expect(result).toContain('name: Alice');
      expect(result).not.toContain('bio');
    });

    test('undefined values are omitted', () => {
      const result = toYAML({ name: 'Alice', bio: undefined });
      expect(result).not.toContain('bio');
    });

    test('nested object uses indentation', () => {
      const result = toYAML({ outer: { inner: 'value' } });
      expect(result).toContain('outer:');
      expect(result).toContain('inner: value');
    });

    test('array value in object', () => {
      const result = toYAML({ items: ['a', 'b'] });
      expect(result).toContain('items:');
      expect(result).toContain('- a');
      expect(result).toContain('- b');
    });

    test('empty array value in object', () => {
      const result = toYAML({ items: [] });
      expect(result).toContain('items: []');
    });

    test('indent parameter', () => {
      const result = toYAML({ key: 'val' }, 1);
      expect(result).toMatch(/^\s+key: val/);
    });
  });
});
