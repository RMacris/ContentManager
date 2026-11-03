/**
 * O casamento de palavras-chave e canais, sem navegador.
 *
 * O `keyword-core.js` é um script clássico (sem import/export) porque o Chrome
 * o carrega junto do content script. Aqui ele roda num contexto `vm` e a suíte
 * confere a normalização (acentos, maiúsculas, pontuação), a comparação por
 * palavra inteira nos títulos e a de conter nos canais.
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/content/keyword-core.js', import.meta.url), 'utf8');
const sandbox = {};
createContext(sandbox);
runInContext(source, sandbox, { filename: 'keyword-core.js' });
const core = sandbox.YTIKeywordFilter ?? runInContext('globalThis.YTIKeywordFilter', sandbox);

let failures = 0;

function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

function checkKeyword(label, text, keywords, expected) {
  const actual = core.matchesKeyword(text, keywords);
  check(label, actual === expected, `esperado ${expected}, veio ${String(actual)}`);
}

function checkChannel(label, text, channels, expected) {
  const actual = core.matchesChannel(text, channels);
  check(label, actual === expected, `esperado ${expected}, veio ${String(actual)}`);
}

process.stdout.write('normalização:\n');
check('minúsculas e acento', core.normalizeText('Inteligência Artificial') === 'inteligencia artificial');
check('pontuação vira espaço', core.normalizeText('ChatGPT-4o: o guia!') === 'chatgpt 4o o guia');
check('espaço não separável', core.normalizeText('há\u00a0palavras') === 'ha palavras');
check('zero-width some', core.normalizeText('IA\u200b') === 'ia');
check('espaços colapsam', core.normalizeText('  gpt   4  ') === 'gpt 4');
check('não-string vira vazio', core.normalizeText(null) === '');

process.stdout.write('\npalavras-chave no título — por palavra inteira:\n');
checkKeyword('termo simples', 'Testando o ChatGPT hoje', ['chatgpt'], true);
checkKeyword('caixa e acento ignorados', 'Tudo sobre INTELIGÊNCIA ARTIFICIAL', ['inteligencia artificial'], true);
checkKeyword('hífen igual a espaço', 'GPT-4 na prática', ['gpt 4'], true);
checkKeyword('palavra no meio', 'Por que eu IA não substitui você', ['ia'], true);
checkKeyword('não casa pedaço de palavra', 'A pianista toca bem', ['ia'], false);
checkKeyword('não casa pedaço no fim', 'O claudson falou', ['claude'], false);
checkKeyword('termo composto por extenso', 'Agentes de IA no dia a dia', ['agentes de ia'], true);
checkKeyword('lista com vários termos', 'Review do Gemini', ['chatgpt', 'gemini', 'claude'], true);
checkKeyword('título limpo', 'Receita de bolo de laranja', ['chatgpt', 'ia'], false);
checkKeyword('palavra-chave vazia é ignorada', 'Qualquer título', ['   '], false);
checkKeyword('lista inválida não casa', 'Qualquer título', 'chatgpt', false);
checkKeyword('título vazio', '', ['chatgpt'], false);

process.stdout.write('\nnomes de canal — basta conter:\n');
checkChannel('nome exato', 'Fernanda Kipper', ['fernanda kipper'], true);
checkChannel('nome com sufixo do card', 'Canal Ruim - Ao vivo', ['Canal Ruim'], true);
checkChannel('acento ignora no card', 'Tecnología Brasileira', ['tecnologia brasileira'], true);
checkChannel('não contém', 'Kipper Fernanda', ['fernanda kipper'], false);
checkChannel('canal limpo', 'Cozinha da Vovó', ['canal ruim'], false);
checkChannel('lista vazia', 'Canal Ruim', [], false);
checkChannel('texto vazio', '', ['canal ruim'], false);

process.stdout.write(
  failures === 0 ? '\npalavras-chave e canais: tudo certo\n' : `\npalavras-chave e canais: ${failures} falha(s)\n`,
);

process.exit(failures === 0 ? 0 : 1);
