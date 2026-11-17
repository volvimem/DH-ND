// Origem: Apps Script operacional, 17 Nov 2026. Somente leitores do contrato da planilha.
const DHPE_CONFIG_SHEET = 'CONFIG';

function lerConfigDHPE_() {

  const arquivo =
    SpreadsheetApp
      .getActiveSpreadsheet();


  const aba =
    arquivo.getSheetByName(
      DHPE_CONFIG_SHEET
    );


  if (!aba) {

    throw new Error(
      'Aba CONFIG não encontrada.'
    );

  }


  const valores =
    aba
      .getDataRange()
      .getDisplayValues();


  const config = {};


  valores.forEach(linha => {

    const chave =
      normalizarTextoDHPE_(
        linha[0]
      );


    const valor =
      String(
        linha[1] || ''
      ).trim();


    if (chave) {
      config[chave] =
        valor;
    }

  });


  return config;

}

function localizarCabecalhoDHPE_(aba) {

  const ultimaLinha =
    Math.min(
      aba.getLastRow(),
      20
    );


  const ultimaColuna =
    aba.getLastColumn();


  if (
    ultimaLinha < 1 ||
    ultimaColuna < 1
  ) {
    return null;
  }


  const dados =
    aba
      .getRange(
        1,
        1,
        ultimaLinha,
        ultimaColuna
      )
      .getDisplayValues();


  for (
    let r = 0;
    r < dados.length;
    r++
  ) {

    const colunas = {};


    dados[r].forEach(
      (texto, indice) => {

        const nome =
          normalizarTextoDHPE_(texto);

        if (nome) {
          colunas[nome] =
            indice + 1;
        }

      }
    );


    if (
      colunas['CATEGORIA'] &&
      colunas['RESULTADO FINAL'] &&
      colunas['ID_SISTEMA']
    ) {

      return {
        linha: r + 1,
        colunas: colunas
      };

    }

  }


  return null;

}

function normalizarTextoDHPE_(
  texto
) {

  return String(
    texto || ''
  )
  .trim()
  .toUpperCase()
  .normalize('NFD')
  .replace(
    /[\u0300-\u036f]/g,
    ''
  );

}
