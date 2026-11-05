'use strict';
function assertNoTemplateTokens(text, source) {
    const tokens = [...new Set(text.match(/%%[A-Z][A-Z0-9_]*%%/g) || [])];
    if (tokens.length) throw Error(`Unresolved template tokens in ${source}: ${tokens.join(', ')}`);
}
module.exports = { assertNoTemplateTokens };
