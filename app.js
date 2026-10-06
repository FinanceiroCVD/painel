// Painel CVD — lê public.painel_comercial() no Supabase com o login de quem está usando.
// A chave abaixo é a "anon" (pública por natureza): sem login a função recusa, e com login
// só responde para e-mails da lista public.painel_acessos.
(() => {
  "use strict";

  const SUPABASE_URL = "https://rbzybyxuwuelfkmrszqb.supabase.co";
  const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJienlieXh1d3VlbGZrbXJzenFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5Njg5NDcsImV4cCI6MjEwNjU0NDk0N30.ebRBKo7cxCcVnrhZ799_1Umgvri6zBTAEzSdvTwPM_Y";
  const RELEITURA_MS = 2 * 60 * 1000;

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "painel-cvd" },
  });

  const $ = (id) => document.getElementById(id);
  const n = (v) => Number(v) || 0;
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const brl2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
  const mesFmt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

  // Cor de cada executivo = um token do design system (segundo canal: o nome sempre vem escrito).
  const COR = { "CAMILLA ALVES": "var(--accent)", "Matheus Quentin": "var(--inv)", "Beatriz Santos": "var(--mkt)" };
  const FAIXA = { meta: "Meta batida", gatilho: "Acima do gatilho", abaixo: "Abaixo do gatilho" };

  let dados = null, mesSel = null, filtroExec = "todos", carregando = false, timer = null;

  // ───────── utilidades ─────────
  function el(tag, attrs = {}, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "style") e.setAttribute("style", v);
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) e.setAttribute(k, v);
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined) e.append(f.nodeType ? f : String(f));
    return e;
  }
  function hojeBrasilia() { return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); }
  function mesAtual() { return hojeBrasilia().slice(0, 7) + "-01"; }
  function nomeMes(iso) { const s = mesFmt.format(new Date(iso + "T00:00:00Z")); return s[0].toUpperCase() + s.slice(1); }
  function diasNoMes(iso) { const d = new Date(iso + "T00:00:00Z"); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); }
  function iniciais(nome) { return String(nome || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase(); }
  function mostrarCarregando(txt) { $("carregandoTexto").textContent = txt || "Carregando…"; $("carregando").hidden = false; }
  function esconderCarregando() { $("carregando").hidden = true; }

  // ───────── entrada ─────────
  function mostrarEntrada(msg) {
    clearInterval(timer); timer = null; dados = null;
    $("app").hidden = true;
    $("entrada").hidden = false;
    $("entradaErro").hidden = !msg;
    $("entradaErro").textContent = msg || "";
    setTimeout(() => $("email").focus(), 0);
  }

  $("formEntrada").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = $("email").value.trim().toLowerCase(), senha = $("senha").value;
    if (!email || !senha) { mostrarEntrada("Informe e-mail e senha."); return; }
    $("btnEntrar").disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    $("btnEntrar").disabled = false;
    if (error) {
      mostrarEntrada(/invalid/i.test(error.message) ? "E-mail ou senha incorretos." : "Não foi possível entrar: " + error.message);
      return;
    }
    $("senha").value = "";
    abrirApp();
  });

  $("btnSair").addEventListener("click", async () => { await sb.auth.signOut(); mostrarEntrada(); });

  // ───────── trocar senha ─────────
  const dlg = $("dlgSenha");
  $("btnSenha").addEventListener("click", () => {
    $("novaSenha").value = ""; $("novaSenha2").value = "";
    $("senhaErro").hidden = true; $("senhaOk").hidden = true;
    dlg.showModal();
  });
  $("btnSenhaCancelar").addEventListener("click", () => dlg.close());
  $("formSenha").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const a = $("novaSenha").value, b = $("novaSenha2").value;
    const erro = (t) => { $("senhaErro").textContent = t; $("senhaErro").hidden = false; $("senhaOk").hidden = true; };
    if (a.length < 8) return erro("Use pelo menos 8 caracteres.");
    if (a !== b) return erro("As duas senhas não são iguais.");
    $("btnSenhaSalvar").disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    $("btnSenhaSalvar").disabled = false;
    if (error) return erro("Não foi possível trocar a senha: " + error.message);
    $("senhaErro").hidden = true; $("senhaOk").hidden = false;
  });

  // ───────── abas ─────────
  function abrirAba(nome) {
    if (nome !== "inicio" && nome !== "comercial") nome = "comercial";
    for (const b of $("nav").querySelectorAll(".sector")) b.setAttribute("aria-current", String(b.dataset.aba === nome));
    $("inicio").hidden = nome !== "inicio";
    $("comercial").hidden = nome !== "comercial";
    if (location.hash !== "#" + nome) history.replaceState(null, "", "#" + nome);
  }
  $("nav").addEventListener("click", (ev) => { const b = ev.target.closest(".sector"); if (b) abrirAba(b.dataset.aba); });

  // ───────── dados ─────────
  async function abrirApp() {
    $("entrada").hidden = true;
    $("app").hidden = false;
    abrirAba(location.hash.slice(1) || "comercial");
    mesSel = mesSel || mesAtual();
    await carregar(true);
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) carregar(false); }, RELEITURA_MS);
  }

  async function carregar(comOverlay) {
    if (carregando) return;
    carregando = true;
    if (comOverlay) mostrarCarregando("Carregando fechamentos…");
    $("btnAtualizar").disabled = true;
    try {
      const { data, error } = await sb.rpc("painel_comercial", { p_mes: mesSel });
      if (error) {
        if (/sem_acesso/.test(error.message)) {
          await sb.auth.signOut();
          mostrarEntrada("Seu e-mail não está liberado para o painel. Peça acesso à Diretoria.");
          return;
        }
        if (/JWT|token/i.test(error.message)) { mostrarEntrada("Sua sessão expirou. Entre de novo."); return; }
        throw error;
      }
      dados = data;
      mesSel = data.mes;
      $("aviso").hidden = true;
      desenhar();
    } catch (e) {
      $("aviso").textContent = "Não foi possível ler os dados agora (" + (e.message || "erro") + "). Os números abaixo são da última leitura; tente Atualizar.";
      $("aviso").hidden = false;
    } finally {
      carregando = false;
      $("btnAtualizar").disabled = false;
      esconderCarregando();
    }
  }

  $("btnAtualizar").addEventListener("click", () => carregar(false));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && dados) carregar(false); });

  // ───────── regras ─────────
  function taxaCoordenacao(receita) {
    if (receita <= 150000) return 0;
    if (receita <= 350000) return 0.01;
    if (receita <= 500000) return 0.0125;
    return 0.015;
  }

  // ───────── desenho ─────────
  function desenhar() {
    const u = dados.usuario || {};
    $("nomeEu").textContent = u.nome || u.email || "";
    $("avatarEu").textContent = iniciais(u.nome || u.email);

    const ex = dados.executivos || [];
    const contratos = dados.contratos || [];
    const atual = mesSel === mesAtual();
    const dias = diasNoMes(mesSel);
    const decorridos = atual ? Number(hojeBrasilia().slice(8, 10)) : dias;

    $("subtitulo").textContent = `Fechamentos, metas, comissões e custos dos executivos · ${nomeMes(mesSel)}` +
      (atual ? ` · dia ${decorridos} de ${dias}` : " · mês encerrado");

    // meses
    const meses = dados.meses && dados.meses.length ? dados.meses : [mesSel];
    $("meses").replaceChildren(...meses.map((m) => el("button", {
      type: "button", "aria-pressed": String(m === mesSel),
      onclick: () => { if (m !== mesSel) { mesSel = m; filtroExec = "todos"; carregar(true); } },
    }, nomeMes(m))));

    if (dados.sync) {
      $("atualizado").textContent = "Agendor lido às " + new Date(dados.sync).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    }

    $("nota").hidden = !ex.some((e) => e.regra_referencia);
    $("nota").textContent = "A política de comissões começa em outubro de 2026: neste mês a variável usa a regra de outubro só como referência.";

    // custos
    const recebido = ex.reduce((s, e) => s + n(e.recebido), 0);
    const metaCelula = ex.reduce((s, e) => s + n(e.meta), 0);
    const qtd = ex.reduce((s, e) => s + n(e.contratos), 0);
    const linhas = ex.map((e) => ({
      pessoa: e.nome_exibicao, vendedor: e.vendedor, funcao: e.cargo, ajuda: n(e.ajuda_custo), variavel: n(e.variavel),
      regra: e.faixa === "meta" ? `Meta batida: ${brl.format(n(e.bonus_meta))} + ${e.contratos} × ${brl.format(n(e.valor_contrato_meta))}`
        : e.faixa === "gatilho" ? `Acima do gatilho: ${e.contratos} × ${brl.format(n(e.valor_acima_gatilho))}` : "Abaixo do gatilho: sem variável",
    }));
    for (const q of dados.equipe || []) {
      if (q.regra_variavel === "coordenacao") {
        const t = taxaCoordenacao(recebido);
        linhas.push({ pessoa: q.pessoa, funcao: q.funcao, ajuda: n(q.ajuda_custo), variavel: t * recebido,
          regra: t ? `${pct.format(t)} sobre ${brl.format(recebido)} da célula` : "Célula até R$ 150 mil: sem variável" });
      } else {
        linhas.push({ pessoa: q.pessoa, funcao: q.funcao, ajuda: n(q.ajuda_custo), variavel: null, regra: q.regra_variavel });
      }
    }
    const totAjuda = linhas.reduce((s, l) => s + l.ajuda, 0);
    const totVar = linhas.reduce((s, l) => s + (l.variavel ?? 0), 0);
    const custo = totAjuda + totVar;

    // números de destaque
    const tile = (num, rot, sub) => el("div", { class: "tile" }, el("span", { class: "tile-n" }, num), el("span", { class: "tile-rot" }, rot), el("span", { class: "tile-sub" }, sub));
    $("tiles").replaceChildren(
      tile(brl.format(recebido), "Recebido da célula", `${pct.format(metaCelula ? recebido / metaCelula : 0)} da meta de ${brl.format(metaCelula)}`),
      tile(String(qtd), "Contratos", "ticket médio " + (qtd ? brl.format(recebido / qtd) : "—")),
      tile(brl.format(custo), "Custo do comercial", `${brl.format(totAjuda)} fixo + ${brl.format(totVar)} variável`),
      tile(recebido ? pct.format(custo / recebido) : "—", "Custo sobre recebido", "quanto do recebido vai para a equipe"),
    );

    // executivos
    $("executivos").replaceChildren(...ex.map((e) => cartao(e, contratos.filter((c) => c.vendedor === e.vendedor), { atual, dias, decorridos })));

    // tabela de custos
    $("custos").replaceChildren(...linhas.map((l) => el("tr", {},
      el("td", { class: "txt" }, l.vendedor ? el("span", { class: "cel-av" }, el("span", { class: "av", style: `background:${COR[l.vendedor] || "var(--text-3)"}` }, iniciais(l.pessoa)), el("b", {}, l.pessoa)) : el("b", {}, l.pessoa)),
      el("td", { class: "txt fnum" }, l.funcao),
      el("td", { class: "fnum" }, brl.format(l.ajuda)),
      el("td", { class: "fnum" }, l.variavel == null ? "a apurar" : brl2.format(l.variavel)),
      el("td", { class: "fnum forte" }, brl2.format(l.ajuda + (l.variavel ?? 0))),
      el("td", { class: "regra" }, l.regra),
    )));
    $("totAjuda").textContent = brl.format(totAjuda);
    $("totVar").textContent = brl2.format(totVar);
    $("totGeral").textContent = brl2.format(custo);

    // contratos
    const opcoes = [["todos", `Todos · ${contratos.length}`], ...ex.map((e) => [e.vendedor, `${e.nome_exibicao} · ${e.contratos}`])];
    if (!opcoes.some(([v]) => v === filtroExec)) filtroExec = "todos";
    $("filtroExec").replaceChildren(...opcoes.map(([v, rot]) => el("button", {
      type: "button", "aria-pressed": String(v === filtroExec), onclick: () => { filtroExec = v; desenhar(); },
    }, rot)));
    const nomes = Object.fromEntries(ex.map((e) => [e.vendedor, e.nome_exibicao]));
    const lista = contratos.filter((c) => filtroExec === "todos" || c.vendedor === filtroExec);
    $("contratos").replaceChildren(...(lista.length ? lista.map((c) => {
      const [, m, d] = String(c.data_fechamento).split("-");
      return el("tr", {},
        el("td", { class: "txt fnum" }, `${d}/${m}`),
        el("td", { class: "txt" }, el("span", { class: "cel-av" }, el("span", { class: "av", style: `background:${COR[c.vendedor] || "var(--text-3)"}` }, iniciais(nomes[c.vendedor] || c.vendedor)), nomes[c.vendedor] || c.vendedor)),
        el("td", { class: "txt" }, c.nome || "—"),
        el("td", { class: "txt fnum" }, c.perfil || "—"),
        el("td", { class: "fnum" }, c.parcelas ?? "—"),
        el("td", { class: "fnum forte" }, brl2.format(n(c.honorarios_iniciais))),
      );
    }) : [el("tr", {}, el("td", { colspan: "6", class: "vazio" }, "Nenhum contrato neste mês ainda."))]));
  }

  function cartao(e, contratos, ritmo) {
    const cor = COR[e.vendedor] || "var(--text-3)";
    const recebido = n(e.recebido), gat = n(e.gatilho), meta = n(e.meta), qtd = n(e.contratos);
    const faltaGat = Math.max(0, gat - recebido), faltaMeta = Math.max(0, meta - recebido);
    const escala = Math.max(meta, recebido, 1);

    // barras diárias: valor dos contratos fechados em cada dia
    const porDia = new Array(ritmo.dias + 1).fill(0);
    for (const c of contratos) { const d = Number(String(c.data_fechamento).slice(8, 10)); if (d >= 1 && d <= ritmo.dias) porDia[d] += n(c.honorarios_iniciais); }
    const maxDia = Math.max(...porDia.slice(1), 1);
    const barras = el("div", { class: "barras", role: "img", "aria-label": `Valor fechado por dia em ${e.nome_exibicao}` });
    const eixo = el("div", { class: "barras-eixo", "aria-hidden": "true" });
    for (let d = 1; d <= ritmo.dias; d++) {
      const v = porDia[d];
      barras.append(el("div", { class: "barra" + (v ? "" : " zero"), title: `${String(d).padStart(2, "0")}: ${brl2.format(v)}` },
        el("i", { style: `height:${v ? Math.max(6, (v / maxDia) * 100) : 0}%` })));
      eixo.append(el("span", {}, d === 1 || d % 5 === 0 ? String(d) : ""));
    }

    const linha = (rot, v) => el("div", { class: "qlinha" }, el("span", { class: "qrot" }, rot), el("span", { class: "qv" }, v));
    const quebra = el("div", { class: "quebra" });
    quebra.append(linha("Contratos", String(qtd)));
    quebra.append(linha("Ticket médio", qtd ? brl.format(recebido / qtd) : "—"));
    if (gat < meta) quebra.append(linha("Falta p/ gatilho", faltaGat ? brl.format(faltaGat) : "atingido"));
    quebra.append(linha("Falta p/ meta", faltaMeta ? brl.format(faltaMeta) : "atingida"));
    if (ritmo.atual && ritmo.decorridos > 0) quebra.append(linha("Projeção do mês", brl.format((recebido / ritmo.decorridos) * ritmo.dias)));

    const trilho = el("div", { class: "prog-trilho", role: "img", "aria-label": `${brl.format(recebido)} de ${brl.format(meta)}` },
      el("i", { style: `width:${Math.min(100, (recebido / escala) * 100)}%` }));
    if (gat < meta) trilho.append(el("span", { class: "marco", title: "Gatilho " + brl.format(gat), style: `left:calc(${(gat / escala) * 100}% - 1px)` }));

    return el("article", { class: "pcard", style: `--sc:${cor}` },
      el("div", { class: "pcard-cab" },
        el("span", { class: "av", style: `background:${cor}` }, iniciais(e.nome_exibicao)),
        el("div", { class: "pessoa-txt" }, el("span", { class: "pessoa-nome" }, e.nome_exibicao), el("span", { class: "pessoa-area" }, e.cargo)),
        el("div", { class: "pcard-tot" }, el("b", {}, brl.format(recebido)), el("span", {}, "recebido"))),
      el("div", { class: "pcard-faixa" },
        el("span", { class: "faixa " + e.faixa }, FAIXA[e.faixa] || e.faixa),
        el("span", {}, `${pct.format(meta ? recebido / meta : 0)} da meta`)),
      el("div", { class: "prog" }, trilho,
        el("div", { class: "prog-eixo" },
          el("span", {}, gat < meta ? "gatilho " : "gatilho = meta ", el("b", {}, brl.format(gat))),
          el("span", {}, "meta ", el("b", {}, brl.format(meta))))),
      el("div", {}, barras, eixo),
      quebra,
      el("div", { class: "pcard-pe" },
        el("span", {}, "Variável ", el("b", {}, brl2.format(n(e.variavel)))),
        el("span", {}, "Ajuda ", el("b", {}, brl.format(n(e.ajuda_custo)))),
        el("span", {}, "Custo ", el("b", {}, brl2.format(n(e.ajuda_custo) + n(e.variavel))))),
    );
  }

  // ───────── início ─────────
  sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT") mostrarEntrada(); });
  (async () => {
    const { data } = await sb.auth.getSession();
    if (data.session) abrirApp(); else mostrarEntrada();
  })();
})();
