/**
 * O parser do filtro de idade, sem navegador.
 *
 * O `age-core.js` é um script clássico (sem import/export) porque o Chrome o
 * carrega junto do content script. Aqui ele roda num contexto `vm` e a suíte
 * confere as formas que o card do YouTube mostra em pt e en, as ações do
 * usuário que não são publicação e os limites em horas e dias.
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/content/age-core.js', import.meta.url), 'utf8');
const sandbox = {};
createContext(sandbox);
runInContext(source, sandbox, { filename: 'age-core.js' });
const core = sandbox.YTIAgeFilter ?? runInContext('globalThis.YTIAgeFilter', sandbox);

// O limite não mora no `age-core.js`: quem chama passa o valor que veio do
// `settings-contract.js`. A suíte usa o mesmo padrão de 72 horas (3 dias).
const MAX_AGE_HOURS = 72;

let failures = 0;

function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHA'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

function ageOf(text) {
  return core.parseAge(text);
}

function checkAge(label, text, expected) {
  const actual = ageOf(text);
  check(label, actual === expected, `esperado ${expected}, veio ${String(actual)}`);
}

function checkHide(label, text, expected) {
  const actual = core.shouldHide(text, MAX_AGE_HOURS);
  check(label, actual === expected, `esperado ${expected}, veio ${String(actual)}`);
}

process.stdout.write('idade dos cards — português:\n');
checkAge('minutos', 'há 10 minutos', 600);
checkAge('horas', 'há 4 horas', 14400);
checkAge('hora abreviada', 'há 5 h', 18000);
checkAge('dia', 'há 1 dia', 86400);
checkAge('dias', 'há 3 dias', 259200);
checkAge('dias (4)', 'há 4 dias', 345600);
checkAge('dias (6)', 'há 6 dias', 518400);
checkAge('semana', 'há 1 semana', 604800);
checkAge('semanas', 'há 2 semanas', 1209600);
checkAge('mês', 'há 1 mês', 2592000);
checkAge('meses', 'há 8 meses', 20736000);
checkAge('ano', 'há 1 ano', 31536000);
checkAge('anos', 'há 10 anos', 315360000);
checkAge('ponto final', 'há 2 h.', 7200);
checkAge('abreviação de semana', 'há 2 sem.', 1209600);
checkAge('espaço não separável', 'há\u00a05\u00a0dias', 432000);
checkAge('caixa alta e acento', 'HA 4 DIAS', 345600);
checkAge('sufixo atrás', '1 dia atrás', 86400);
checkAge('sufixo atrás (semanas)', '2 semanas atrás', 1209600);
checkAge('sufixo atrás (mês)', '1 mês atrás', 2592000);

process.stdout.write('\nidade dos cards — inglês:\n');
checkAge('minutes', '10 minutes ago', 600);
checkAge('hours', '4 hours ago', 14400);
checkAge('day', '1 day ago', 86400);
checkAge('days', '3 days ago', 259200);
checkAge('weeks', '2 weeks ago', 1209600);
checkAge('month', '1 month ago', 2592000);
checkAge('years', '10 years ago', 315360000);
checkAge('streamed', 'Streamed 2 days ago', 172800);
checkAge('premiered', 'Premiered 1 day ago', 86400);
checkAge('hr', '1 hr ago', 3600);
checkAge('wk', '1 wk ago', 604800);
checkAge('mo', '1 mo ago', 2592000);
checkAge('yr', '1 yr ago', 31536000);

process.stdout.write('\nidade dos cards — o texto real do card:\n');
checkAge('views + idade', '591 mil há 5 h', 18000);
checkAge('views + ano', '20 mil há 1 ano', 31536000);
checkAge('canal colado + idade', 'Fernanda Kipper20 mil há 1 ano', 31536000);
checkAge('meta duplicada', 'Fernanda Kipper Fernanda Kipper • • 94 mil há 1 ano', 31536000);
checkAge('vírgula de milhar', '1,9 mi há 1 dia', 86400);

process.stdout.write('\nações do usuário não são publicação:\n');
checkAge('watched', 'Watched 2 days ago', null);
checkAge('assistido', 'Assistido há 2 dias', null);
checkAge('assistiu', 'Assistiu há 2 dias', null);
checkAge('liked', 'Liked 1 week ago', null);
checkAge('curtido', 'Curtido há 2 dias', null);
checkAge('added', 'Added 2 days ago', null);
checkAge('adicionado', 'Adicionado há 2 dias', null);
checkAge('saved', 'Saved 2 days ago', null);
checkAge('salvo', 'Salvo há 2 dias', null);
checkAge('updated', 'Updated 2 days ago', null);
checkAge('atualizado', 'Atualizado há 2 dias', null);

process.stdout.write('\no que não é data:\n');
checkAge('ao vivo', 'Live now', null);
checkAge('agendado', 'Scheduled for 2 hours from now', null);
checkAge('estreia futura', 'Premieres in 2 days', null);
checkAge('sem views', 'No views', null);
checkAge('views', '1.2M views', null);
checkAge('vazio', '', null);
checkAge('duração', '1:03:01', null);
checkAge('texto solto', 'Um vídeo de verdade', null);

process.stdout.write('\nlimite: 72 horas ficam, mais que isso some:\n');
checkHide('3 dias fica', 'há 3 dias', false);
checkHide('4 dias some', 'há 4 dias', true);
checkHide('3 days fica', '3 days ago', false);
checkHide('4 days some', '4 days ago', true);
checkHide('2 dias fica', '2 days ago', false);
checkHide('semana some', 'há 1 semana', true);
checkHide('mês some', 'há 1 mês', true);
checkHide('ano some', 'há 10 anos', true);
checkHide('streamed 2 dias fica', 'Streamed 2 days ago', false);
checkHide('ação fica', 'Watched 2 days ago', false);
checkHide('vivo fica', 'Live now', false);
checkHide('agendado fica', 'Scheduled for 2 hours from now', false);

process.stdout.write('\nlimite de idade configurável em horas:\n');
check('6 horas no limite ficam', core.shouldHide('6 hours ago', 6) === false);
check('7 horas acima do limite somem', core.shouldHide('7 hours ago', 6) === true);
check('5 horas no limite de 6 ficam', core.shouldHide('há 5 horas', 6) === false);
check('1 hora no limite de 1 fica', core.shouldHide('1 hour ago', 1) === false);
check('2 horas acima do limite de 1 somem', core.shouldHide('2 hours ago', 1) === true);
check('7 dias no limite de 168 horas ficam', core.shouldHide('7 days ago', 168) === false);
check('8 dias acima do limite de 168 horas somem', core.shouldHide('8 days ago', 168) === true);

process.stdout.write('\nshouldHideAge:\n');
check('o core não declara um limite padrão', core.MAX_AGE_HOURS === undefined);
check('null fica', core.shouldHideAge(null, MAX_AGE_HOURS) === false);
check('zero fica', core.shouldHideAge(0, MAX_AGE_HOURS) === false);
check('72 horas fica', core.shouldHideAge(259200, MAX_AGE_HOURS) === false);
check('72 horas + 1 s some', core.shouldHideAge(259201, MAX_AGE_HOURS) === true);
check('96 horas some', core.shouldHideAge(345600, MAX_AGE_HOURS) === true);
check('NaN fica', core.shouldHideAge(Number.NaN, MAX_AGE_HOURS) === false);
check('infinito fica', core.shouldHideAge(Number.POSITIVE_INFINITY, MAX_AGE_HOURS) === false);
check('limite ausente não esconde', core.shouldHideAge(345600) === false);

process.stdout.write(
  failures === 0
    ? '\nidade dos cards: tudo certo\n'
    : `\nidade dos cards: ${failures} falha(s)\n`,
);

process.exit(failures === 0 ? 0 : 1);
