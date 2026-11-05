// Grammatical gender of the report text, taken from the sex informed at registration.

/** 'f' | 'm' | null (not informed: neutral wording). */
export function genderOf(sex) {
  const s = String(sex || '').trim().toLowerCase();
  return s.startsWith('fem') ? 'f' : s.startsWith('masc') ? 'm' : null;
}

export function genderRule(gender) {
  if (gender === 'f') return 'A pessoa avaliada é do sexo feminino: escreva todo o texto no feminino, sempre "a examinada" e "a paciente" (nunca "o examinado" ou "o paciente"), com artigos, pronomes, adjetivos e particípios concordando (ex.: "A examinada foi encaminhada", "avaliada", "atenta", "ela").';
  if (gender === 'm') return 'A pessoa avaliada é do sexo masculino: escreva todo o texto no masculino, sempre "o examinado" e "o paciente" (nunca "a examinada" ou "a paciente"), com artigos, pronomes, adjetivos e particípios concordando (ex.: "O examinado foi encaminhado", "avaliado", "atento", "ele").';
  return 'O sexo da pessoa avaliada não foi informado: não presuma; use "a pessoa avaliada" e construções neutras, sem "o examinado" nem "a examinada".';
}

const WRONG = {
  f: /\b(?:o|do|ao|pelo|no)\s+(?:examinado|paciente)\b|\bexaminado\b/gi,
  m: /\b(?:a|da|à|pela|na)\s+(?:examinada|paciente)\b|\bexaminada\b/gi,
};

/** Terms that contradict the informed sex, as found in the text. */
export function genderProblems(gender, text) {
  const re = WRONG[gender];
  return re ? [...new Set(String(text || '').match(re) || [])] : [];
}
