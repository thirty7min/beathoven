# Beathoven

## Code style

- No comments. Code must explain itself through naming and structure.
- Only exception: something genuinely non-obvious that a reader would get wrong without it (lock ordering, a browser quirk workaround, a security constraint). One short line, explaining why, never what.
- No JSDoc that restates the name or signature. No section-divider comments. No commented-out code.
- SQL migrations follow the same rule. Applied migrations are never edited.
- Match surrounding code: naming, idiom, structure.
