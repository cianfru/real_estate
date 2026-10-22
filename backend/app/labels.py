"""Italian labels for PVP codes. Served by GET /meta so the frontend has a single source."""

CATEGORIE = {
    "IMMOBILE_RESIDENZIALE": "Residenziale",
    "IMMOBILE_COMMERCIALE": "Commerciale",
    "IMMOBILE_INDUSTRIALE": "Industriale",
    "IMPIANTO_SPORTIVO": "Impianto sportivo",
    "ALTRA_CATEGORIA": "Altro",
}

MODALITA = {
    "VENDTEL": "Sincrona telematica",
    "VENDMIS": "Sincrona mista",
    "VENDAS": "Asincrona telematica",
    "VENDPDO": "Presso il venditore",
}

TIPO_VENDITA = {
    "SENIN": "Senza incanto",
    "CONIN": "Con incanto",
    "COMPE": "Competitiva",
    "SINAQ": "Senza incanto (aumento di un quinto)",
    "TRCOM": "Tramite commissionario",
}

OCCUPAZIONE = {
    "LIBER": "Libero",
    "OCCUP": "Occupato",
    "OCCST": "Occupato senza titolo",
    "INCOR": "In corso di liberazione",
    "NON_SPECIFICATA": "Non specificata",
}

ESITI = {"AGGIU": "Aggiudicata", "ASDES": "Deserta"}

STATUS = {
    "active": "In asta",
    "sold": "Aggiudicato",
    "withdrawn": "Ritirato",
    "unknown": "In attesa / non più visibile",
    "merged": "Unito ad altro lotto",
}

ALLEGATI = {
    "perizia": "Perizia",
    "avviso": "Avviso di vendita",
    "ordinanza": "Ordinanza",
    "foto": "Foto",
    "planimetria": "Planimetria",
    "other": "Altro",
}

EVENTI = {
    "new_lot": "Nuovo immobile",
    "new_round": "Nuovo esperimento",
    "price_drop": "Ribasso",
    "price_change": "Prezzo modificato",
    "deadline_changed": "Termine offerte modificato",
    "date_changed": "Data vendita anticipata",
    "postponed": "Vendita rinviata",
    "cancelled": "Non più pubblicato",
    "outcome": "Esito",
    "geocoded": "Posizione calcolata",
}

CLIENTE_STATUS = {
    "in_valutazione": "In valutazione",
    "offerta_presentata": "Offerta presentata",
    "aggiudicato": "Aggiudicato",
    "scartato": "Scartato",
}

# PVP 'categoriaBene' codes under tipoLotto=IMMOBILI (from bo-ms/filtriRicercaVendite).
TIPOLOGIE = {
    "ABITAZIONE_IN_VILLE": "Abitazione in ville",
    "ABITAZIONE_IN_VILLINI": "Abitazione in villini",
    "ABITAZIONE_TIPO_CIV": "Abitazione di tipo civile",
    "ABITAZIONE_TIPO_ECO": "Abitazione di tipo economico",
    "ABITAZIONE_TIPO_POP": "Abitazione di tipo popolare",
    "ABITAZIONE_TIPO_RUR": "Abitazione di tipo rurale",
    "ABITAZIONE_TIPO_SIGN": "Abitazione di tipo signorile",
    "ABITAZIONE_TIPO_UPOP": "Abitazione di tipo ultrapopolare",
    "ABITAZIONI_E_ALL_TIPICI": "Abitazioni e alloggi tipici dei luoghi",
    "ALBERGHI_E_PENSIONI": "Alberghi e pensioni",
    "ALBERGO_E_PENSIONE": "Albergo e pensione",
    "APPARTAMENTO": "Appartamento",
    "CANTINA": "Cantina",
    "CASA_DI_CURA_O_OSPEDALE": "Casa di cura o ospedale",
    "CASE_DI_CURA_E_OSPEDALI": "Case di cura e ospedali",
    "CASTELLI_PALAZZI": "Castelli, palazzi di eminenti pregi artistici",
    "CASTEL_IMM_PREGIO_STR": "Castello, immobile di pregio artistico e storico",
    "COMPENDIO_PIGNORATO": "Compendio pignorato",
    "CONVENTO_CONVITTO_O_ISTITUTO_SIMILARE": "Convento, convitto o istituto similare",
    "DEPOSITO": "Deposito",
    "EDIFICI_A_DESTINAZIONE_PARTICOLARE": "Edifici a destinazione particolare",
    "EDIFICI_GALLEGGIANTI_O_SOSPESI": "Edifici galleggianti o sospesi fissati al suolo",
    "FABBRICATI_AGRICOLI": "Fabbricati per attività agricole",
    "FABBRICATI_COMMERCIALI": "Fabbricati costruiti per esigenze commerciali",
    "FABBRICATI_COSTRUITI_PER_ESIGENZE_IND": "Fabbricati costruiti per esigenze industriali",
    "FABBRICATI_E_LOCALI_PER_ESERCIZI_SPORTIVI": "Fabbricati e locali per esercizi sportivi",
    "FABBRICATI_E_LOCALI_SPORTIVI_CON_LUCRO": "Fabbricati, locali sportivi con fini di lucro",
    "FABBRICATO": "Fabbricato",
    "FABBRICATO_IN_COSTR": "Fabbricato in corso di costruzione",
    "FABBRICATO_RURALE": "Fabbricato rurale",
    "GARAGE_AUTORIMESSA": "Garage o autorimessa",
    "ISTITUTO_CREDITO_CAMBIO": "Istituto di credito, cambio e assicurazioni",
    "LABORATORIO_ARTIGIANO": "Laboratorio artigiano",
    "LABORATORI_ARTI": "Laboratori per arti e mestieri",
    "LASTRICO_SOLARE": "Lastrico solare",
    "LOTTO_EDIFICABILE": "Lotto edificabile",
    "MAGAZZINI_DEPOSITO": "Magazzini sotterranei, deposito di derrate",
    "MAGAZZINI_E_DEPOSITO": "Magazzini e locali di deposito",
    "MAGAZZINO": "Magazzino",
    "NEGOZIO": "Negozio",
    "NEGOZI_BOTTEGHE": "Negozi, botteghe",
    "OPIFICI": "Opifici",
    "OPIFICIO_INDUSTRIALE": "Opificio industriale",
    "PALCO_TEATRALE": "Palco teatrale",
    "PALESTRA_O_ALTRO_IMMOBILE": "Palestra o altro immobile di uso sportivo",
    "PORZIONE_DI_FABBRICATO": "Porzione di fabbricato in corso di costruzione",
    "PORZIONE_DI_IMMOBILE": "Porzione di immobile",
    "POSTO_AUTO": "Posto auto",
    "POZZO": "Pozzo",
    "STABILIMENTI_BALNEARI_CURATIVI": "Stabilimenti balneari e di acque curative",
    "STABILIMENTO_BALNEARE": "Stabilimento balneare",
    "STALLE_SCUDERIE_RIMESSE": "Stalle, scuderie, rimesse, autorimesse",
    "TEATRI_CINEMATOGRAFI_SALE": "Teatri, cinematografi, sale per concerti",
    "TERRENO": "Terreno",
    "TETTOIE_CHIUSE_APERTE": "Tettoie chiuse o aperte",
    "UFFICIO": "Ufficio",
    "UFFICI_E_STUDI": "Uffici e studi privati",
    "VILLA": "Villa",
}


def tipologia_label(code: str | None) -> str | None:
    if not code:
        return None
    return TIPOLOGIE.get(code) or code.replace("_", " ").capitalize()
