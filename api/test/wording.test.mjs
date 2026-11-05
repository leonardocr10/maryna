import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryTerms, numberTerms, wordingProblems} from '../src/wording.mjs';

test('catches performance categories, including single words', () => {
  for (const t of ['A avalianda apresentou desempenho inferior em memória', 'desempenho superior em velocidade', 'resultado muito inferior', 'ficou na média', 'na faixa média', 'classificação limítrofe', 'rendimento deficitário', 'memória rebaixada', 'abaixo do esperado', 'acima da média', 'dentro do esperado', 'esperado para a idade', 'percentil elevado', 'desempenho baixo', 'pontuação alta', 'resultados elevados'])
    assert.ok(categoryTerms(t).length, t);
});

test('keeps ordinary words that are not categories', () => {
  for (const t of ['Cursa o ensino superior completo.', 'Tem formação superior.', 'nível superior', 'Dor nos membros inferiores.', 'Estuda no ensino médio.', 'Demonstrou dificuldade para reter informações verbais.', 'Recursos preservados, com maior facilidade em tarefas visuais.', 'Alta hospitalar após uma semana.'])
    assert.deepEqual(categoryTerms(t), [], t);
});

test('numbers keep test names, ages and placeholders out', () => {
  assert.deepEqual(numberTerms('QI total de 115, percentil 84,5, 7 acertos'), ['115', '84,5', '7']);
  assert.deepEqual(numberTerms('WISC-IV, DIVA-5, SRS-2, Teste dos 5 Dígitos, 12 anos, 6º ano, [PESSOA_1]'), []);
});

test('wordingProblems applies only the requested checks', () => {
  const text = 'Desempenho inferior, com 7 acertos.';
  assert.equal(wordingProblems(text, {categories: true, numbers: true}).length, 2);
  assert.equal(wordingProblems(text, {categories: true}).length, 1);
  assert.deepEqual(wordingProblems(text, {categories: false, numbers: false}), []);
});
