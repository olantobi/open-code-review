import { describe, it, expect } from 'vitest';

// Test the sync logic extracted from updateProjectVersion.
// We test the JSON update and regex replacement logic directly
// rather than importing the full class (which requires Nx runtime).

describe('version-actions sync logic', () => {
  describe('plugin.json version sync', () => {
    it('updates the version field in plugin.json', () => {
      const original = JSON.stringify(
        {
          name: 'ocr',
          description: 'Test plugin',
          version: '1.0.0',
          author: { name: 'Test' },
        },
        null,
        2,
      );

      const parsed = JSON.parse(original);
      parsed.version = '2.0.0';
      const updated = JSON.stringify(parsed, null, 2) + '\n';

      expect(JSON.parse(updated).version).toBe('2.0.0');
      // Ensure other fields are preserved
      expect(JSON.parse(updated).name).toBe('ocr');
      expect(JSON.parse(updated).description).toBe('Test plugin');
    });
  });

  describe('SKILL.md frontmatter version sync', () => {
    const skillContent = `---
name: ocr
description: |
  AI-powered multi-agent code review.
license: Apache-2.0
metadata:
  author: spencermarx
  version: "1.0.0"
  repository: https://github.com/test/repo
---

# Open Code Review
`;

    const versionRegex = /^(\s*version:\s*)"[^"]*"/m;

    it('updates the version in YAML frontmatter', () => {
      const updated = skillContent.replace(versionRegex, `$1"2.0.0"`);
      expect(updated).toContain('version: "2.0.0"');
      expect(updated).not.toContain('version: "1.0.0"');
    });

    it('preserves surrounding content', () => {
      const updated = skillContent.replace(versionRegex, `$1"2.0.0"`);
      expect(updated).toContain('name: ocr');
      expect(updated).toContain('author: spencermarx');
      expect(updated).toContain('# Open Code Review');
    });

    it('preserves indentation', () => {
      const updated = skillContent.replace(versionRegex, `$1"2.0.0"`);
      // The version line should maintain its original indentation
      expect(updated).toMatch(/^\s{2}version: "2.0.0"/m);
    });

    it('detects when regex does not match (no-op)', () => {
      const noVersionContent = `---
name: ocr
metadata:
  author: spencermarx
---
`;
      const updated = noVersionContent.replace(versionRegex, `$1"2.0.0"`);
      expect(updated).toBe(noVersionContent); // No change = no match
    });

    it('detects unquoted version as no-op', () => {
      const unquotedContent = `---
metadata:
  version: 1.0.0
---
`;
      const updated = unquotedContent.replace(versionRegex, `$1"2.0.0"`);
      expect(updated).toBe(unquotedContent); // Unquoted doesn't match
    });

    it('handles single-quoted version as no-op', () => {
      const singleQuotedContent = `---
metadata:
  version: '1.0.0'
---
`;
      const updated = singleQuotedContent.replace(
        versionRegex,
        `$1"2.0.0"`,
      );
      expect(updated).toBe(singleQuotedContent); // Single quotes don't match
    });
  });
});
