// 100% synthetic anamnesis notes for the comparison (no real patient). Written the way notes usually arrive:
// telegraphic, abbreviated, with informants, a divergence, an unknown and an ambiguous medical term.
// Names already appear as the privacy placeholders the server sends.
export const ANAMNESIS_CASES = [
  {
    id: 'crianca-escolar',
    sex: 'feminino',
    notes: [
      'Entrevista com a mãe ([PESSOA_1]) e o pai ([PESSOA_2]).',
      'Motivo: escola pediu avaliação. Dificuldade p/ copiar do quadro, esquece tarefas, demora p/ terminar atividades. Mãe quer saber se é atenção.',
      'Gestação planejada, pré-natal ok. Parto cesárea 38 sem. Chorou logo. Mãe não lembra peso.',
      'Sentou 7m, andou 1a2m. Primeiras palavras ~1a. Frases depois dos 2a segundo a mãe; pai acha que foi antes.',
      'Rotina: acorda 6h, demora p/ se arrumar. Geralmente não toma café. Mãe leva à escola. Sai às 11h25. À tarde TV e tablet, faz tarefa com a mãe, muita ajuda.',
      'Sono: dorme 22h, demora p/ pegar no sono, às vezes acorda de madrugada e vai p/ cama dos pais. Ronco não sabem.',
      'Alimentação: seletiva, não come verdura. Come bem arroz feijão carne.',
      'Escola: 3º ano, escola municipal. Prof diz que é dispersa, conversa, perde material. Leitura silabada. Matemática melhor.',
      'Emocional: chora qdo erra, diz que é burra. Medo de escuro. Ansiosa antes de prova.',
      'Social: tem 2 amigas, prefere brincar com crianças menores. Briga c/ irmão mais velho.',
      'Sensorial: incomoda etiqueta de roupa, tapa ouvido com barulho alto.',
      'Saúde: aos 5a caiu do escorregador e fraturou o cox, ficou 1 mês em repouso. Usa um remédio p/ alergia, mãe não lembra o nome. Sem internações.',
      'Família: pai teve dificuldade na escola, não terminou ensino médio. Tia materna com depressão.',
      'Autonomia: toma banho sozinha mas mãe confere. Não amarra tênis.',
    ],
    facts: ['6h', '11h25', 'café', 'quadro', 'cesárea', '38', 'escorregador', 'cox', 'alergia', 'etiqueta', 'escuro', 'irmão', 'tênis', 'leitura', 'matemática', 'tablet', 'madrugada', 'verdura'],
    invented: ['TDAH', 'déficit de atenção diagnosticado', 'cóccix', 'loratadina', 'ritalina', 'dislexia', 'autismo', 'TEA'],
  },
];
