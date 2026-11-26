(function () {
  'use strict';

  var CFG = window.AGENDA_CONFIG || {};
  var CHAVE_SESSAO = 'agenda-clinica-sessao';
  var DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var CLASSE = { cirurgia: 's', consulta: 'c', retorno: 'r', procedimento: 'p', outro: 'o' };
  var ROTULO = { s: 'Cirurgia', c: 'Consulta', r: 'Retorno', p: 'Procedimento', o: 'Outro' };
  var PLURAL = { s: ['cirurgia', 'cirurgias'], c: ['consulta', 'consultas'], r: ['retorno', 'retornos'], p: ['procedimento', 'procedimentos'] };
  var ERROS = {
    nao_autorizado: 'Este e-mail não tem acesso à agenda. Peça a um administrador para incluí-lo na lista.',
    credencial_invalida: 'Não foi possível confirmar o login com o Google. Tente de novo.',
    sessao_expirada: 'Sua sessão expirou. Entre de novo.',
    sessao_invalida: 'Sua sessão não é mais válida. Entre de novo.',
    planilha_acessos: 'A lista de acessos não foi encontrada. Avise o administrador.',
    periodo_invalido: 'Não foi possível abrir este período.'
  };
  var ERROS_DE_SESSAO = { nao_autorizado: 1, sessao_expirada: 1, sessao_invalida: 1 };

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function mins(hm) { var p = hm.split(':'); return +p[0] * 60 + +p[1]; }
  function hojeData() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function somaDias(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function chave(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function deChave(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function segunda(off) { var h = hojeData(); return somaDias(h, -((h.getDay() + 6) % 7) + 7 * off); }
  function horaLocal(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  // ---------- Estado ----------
  var sessao = null;        // { token, nome, papel }
  var semanaOff = 0;        // 0 = esta semana
  var selecionado = null;   // 'YYYY-MM-DD'
  var semanas = {};         // semanas já carregadas, só na memória: 'YYYY-MM-DD' (segunda) -> resposta
  var dados = null;         // resposta da semana aberta (atalho)
  var filtro = 'todos';
  var abertoId = null;
  var telVisivel = {};
  var motivoVisivel = {};
  var ultimaCarga = 0;
  var carregando = false;
  var googleIniciado = false;

  function lerSessao() {
    try { var s = JSON.parse(localStorage.getItem(CHAVE_SESSAO) || 'null'); return s && s.token ? s : null; } catch (e) { return null; }
  }
  function salvarSessao() { try { localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao)); } catch (e) { /* segue só em memória */ } }
  function limparSessao() { sessao = null; dados = null; semanas = {}; try { localStorage.removeItem(CHAVE_SESSAO); } catch (e) { /* nada */ } }

  // ---------- Servidor ----------
  function chama(corpo) {
    // Texto simples evita o pedido de verificação prévia (CORS) que o Apps Script não responde.
    return fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpo)
    }).then(function (r) { return r.json(); });
  }

  function configurado() {
    return !!CFG.CLIENT_ID && !!CFG.API_URL && !/COLE_AQUI/.test(CFG.CLIENT_ID + CFG.API_URL);
  }

  // ---------- Login ----------
  function corDaBarra() { /* a cor da barra segue o claro/escuro do aparelho (meta theme-color com media) */ }

  function mostraLoginMsg(texto, erro) {
    var m = $('login-msg');
    m.hidden = !texto;
    m.textContent = texto || '';
    m.className = 'msg' + (erro ? ' erro' : '');
  }

  function mostrarLogin(mensagem) {
    $('principal').hidden = true;
    $('login').hidden = false;
    corDaBarra('#140f1f');
    mostraLoginMsg(mensagem || '', !!mensagem);
    if (!configurado()) {
      mostraLoginMsg('O app ainda não foi configurado. Preencha o arquivo config.js, como explica o guia de instalação.', true);
      return;
    }
    iniciaGoogle();
  }

  function iniciaGoogle() {
    if (googleIniciado) return;
    var tentativas = 0;
    (function espera() {
      if (window.google && google.accounts && google.accounts.id) {
        googleIniciado = true;
        google.accounts.id.initialize({ client_id: CFG.CLIENT_ID, callback: aoReceberCredencial, auto_select: false });
        google.accounts.id.renderButton($('gsi-botao'), { theme: (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'filled_black' : 'outline', shape: 'pill', size: 'large', text: 'signin_with', locale: 'pt-BR', width: 300 });
      } else if (tentativas++ < 100) {
        setTimeout(espera, 100);
      } else {
        mostraLoginMsg('Não foi possível carregar o login do Google. Verifique a conexão com a internet.', true);
      }
    })();
  }

  function aoReceberCredencial(resp) {
    mostraLoginMsg('Entrando…', false);
    chama({ acao: 'entrar', credencial: resp && resp.credential }).then(function (r) {
      if (r.ok) {
        sessao = { token: r.token, nome: r.nome, papel: r.papel };
        salvarSessao();
        mostrarPrincipal();
        carregar();
      } else {
        mostraLoginMsg(ERROS[r.erro] || 'Algo deu errado. Tente de novo em instantes.', true);
      }
    }).catch(function () {
      mostraLoginMsg('Sem conexão com o servidor. Tente de novo.', true);
    });
  }

  // ---------- Agenda ----------
  function mostrarPrincipal() {
    $('login').hidden = true;
    document.documentElement.classList.remove('em-login');
    corDaBarra('#7a2e3b');
    $('principal').hidden = false;
    $('quem').textContent = (sessao.nome || 'Você') + (sessao.papel === 'admin' ? ' · administrador' : '');
  }

  function mostraStatus(texto, erro) {
    var s = $('status');
    s.hidden = !texto;
    s.textContent = texto || '';
    s.className = 'msg' + (erro ? ' erro' : '');
  }

  function pedeSemana(off, fresco) {
    var ini = segunda(off), fim = somaDias(ini, 6);
    return chama({ acao: 'agenda', token: sessao.token, desde: chave(ini), ate: chave(fim), fresco: !!fresco });
  }

  function aceitaErroDeSessao(r) {
    if (ERROS_DE_SESSAO[r.erro]) { limparSessao(); mostrarLogin(ERROS[r.erro]); return true; }
    return false;
  }

  // Busca em segundo plano a semana anterior e a seguinte, para a troca de semana ser instantânea.
  function precarrega() {
    [semanaOff + 1, semanaOff - 1].forEach(function (off) {
      var k = chave(segunda(off));
      if (semanas[k] || !sessao) return;
      pedeSemana(off, false).then(function (r) {
        if (r && r.ok && sessao) { semanas[k] = r; }
      }).catch(function () { /* sem problema: carrega quando a pessoa abrir a semana */ });
    });
  }

  function carregar(fresco) {
    if (carregando || !sessao) return;
    var k = chave(segunda(semanaOff));
    if (!fresco && semanas[k]) { dados = semanas[k]; render(); precarrega(); return; }
    carregando = true;
    if (!semanas[k]) mostraStatus('Carregando a agenda…', false);
    pedeSemana(semanaOff, fresco).then(function (r) {
      carregando = false;
      if (!r.ok) {
        if (aceitaErroDeSessao(r)) return;
        mostraStatus(ERROS[r.erro] || 'Não foi possível carregar a agenda agora.', true);
        return;
      }
      semanas[r.desde] = r;
      if (r.desde !== chave(segunda(semanaOff))) return; // a pessoa já mudou de semana
      dados = r;
      ultimaCarga = Date.now();
      sessao.nome = r.nome; sessao.papel = r.papel;
      salvarSessao();
      $('quem').textContent = (r.nome || 'Você') + (r.papel === 'admin' ? ' · administrador' : '');
      mostraStatus('', false);
      $('atualizado').textContent = 'Atualizado às ' + horaLocal(ultimaCarga);
      render();
      precarrega();
    }).catch(function () {
      carregando = false;
      mostraStatus('Sem conexão com o servidor.' + (dados ? ' Mostrando o que foi carregado às ' + horaLocal(ultimaCarga) + '.' : ''), true);
      render();
    });
  }

  function itensDoDia(k) {
    return dados && dados.desde === chave(segunda(semanaOff)) ? dados.itens.filter(function (x) { return x.data === k; }) : [];
  }

  function renderSemana() {
    var ini = segunda(semanaOff), fim = somaDias(ini, 6);
    var f = function (d) { return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', ''); };
    $('semana-rotulo').textContent = f(ini) + ' a ' + f(fim);
    var wk = $('week');
    wk.innerHTML = '';
    for (var i = 0; i < 7; i++) {
      var dt = somaDias(ini, i), k = chave(dt);
      var ativos = itensDoDia(k).filter(function (x) { return !x.desmarcada; });
      var b = document.createElement('button');
      b.className = 'day' + (k === chave(hojeData()) ? ' today' : '');
      b.setAttribute('aria-pressed', k === selecionado ? 'true' : 'false');
      b.setAttribute('aria-label', dt.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
      var dots = '';
      ['s', 'c', 'r', 'p'].forEach(function (c) {
        if (ativos.some(function (x) { return CLASSE[x.tipo] === c; })) dots += '<span class="dot ' + c + '"></span>';
      });
      b.innerHTML = '<span class="dow">' + DOW[dt.getDay()] + '</span><span class="num">' + dt.getDate() + '</span><span class="dots">' + dots + '</span>';
      b.addEventListener('click', (function (kk) { return function () { selecionado = kk; abertoId = null; render(); }; })(k));
      wk.appendChild(b);
    }
  }

  function cardHtml(x, isOpen, isNext, admin) {
    var c = CLASSE[x.tipo] || 'o';
    var temDetalhes = !!x.telefone || admin;
    var chips = [];
    if (x.quarto) chips.push('<span class="room">Quarto ' + esc(x.quarto) + '</span>');
    if (x.tipo === 'cirurgia' && !x.desmarcada) chips.push(x.confirmada ? '<span class="ok">✓ Confirmada</span>' : '<span class="tbc">A confirmar</span>');
    if (x.modalidade) chips.push('<span class="mod">' + esc(x.modalidade) + '</span>');
    if (x.cidade) chips.push('<span class="city">' + esc(x.cidade) + '</span>');
    (x.notas || []).forEach(function (n) { chips.push('<span class="note">' + esc(n) + '</span>'); });
    var meta = chips.length ? '<span class="meta">' + chips.join('') + '</span>' : '';

    var more = '';
    if (temDetalhes) {
      more = '<div class="more">';
      if (x.telefone) {
        more += telVisivel[x.id]
          ? '<span><b>Contato:</b> <span class="phone">' + esc(x.telefone) + '</span></span>'
          : '<button class="small-btn" data-phone="' + esc(x.id) + '">Ver contato</button>';
      }
      if (admin && x.operador) more += '<span><b>Agendado por:</b> ' + esc(x.operador) + '</span>';
      if (admin && x.titulo) more += '<span><b>Título na agenda:</b></span><code>' + esc(x.titulo) + '</code>';
      if (admin) (x.avisos || []).forEach(function (a) { if (a !== 'sem turno') more += '<span class="warn">Conferir: ' + esc(a) + '</span>'; });
      more += '</div>';
    }
    var why = '';
    if (x.desmarcada && x.motivo) {
      why = '<div class="why">' + (motivoVisivel[x.id]
        ? '<span class="reason">' + esc(x.motivo) + '</span>'
        : '<button class="small-btn" data-why="' + esc(x.id) + '">Ver motivo</button>') + '</div>';
    }
    var head = temDetalhes ? '<button class="head" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' : '<div class="head">';
    var headEnd = temDetalhes ? '</button>' : '</div>';
    return '<div class="card' + (isOpen ? ' open' : '') + (x.desmarcada ? ' canceled' : '') + '">' +
      head +
        '<span class="top"><span class="pill ' + c + '">' + ROTULO[c] + '</span>' +
        (x.desmarcada ? '<span class="pill x">Desmarcada</span>' : (isNext ? '<span class="tag">Próximo</span>' : '')) + '</span>' +
        '<span class="patient">' + esc(x.paciente || x.titulo || 'Sem nome') + '</span>' +
        (x.procedimento ? '<span class="what">' + esc(x.procedimento) + '</span>' : '') +
        meta +
      headEnd + more + why +
    '</div>';
  }

  function renderLista() {
    var admin = !!(dados && dados.papel === 'admin');
    var all = itensDoDia(selecionado);
    var ativos = all.filter(function (x) { return !x.desmarcada; });
    var partes = [];
    ['s', 'c', 'r', 'p'].forEach(function (c) {
      var n = ativos.filter(function (x) { return CLASSE[x.tipo] === c; }).length;
      if (n) partes.push(n + ' ' + PLURAL[c][n === 1 ? 0 : 1]);
    });
    var nx = all.length - ativos.length;
    if (nx) partes.push(nx + (nx === 1 ? ' desmarcada' : ' desmarcadas'));
    $('count').textContent = dados ? (partes.length ? partes.join(' · ') : 'Dia sem agendamentos') : '';

    $('avisos').innerHTML = dados ? dados.avisos.filter(function (a) { return a.data === selecionado; })
      .map(function (a) { return '<div class="banner">Aviso do dia: ' + esc(a.texto) + '</div>'; }).join('') : '';

    var lista = $('list');
    lista.innerHTML = '';
    if (!dados) return;
    var items = all.filter(function (x) { return filtro === 'todos' || CLASSE[x.tipo] === filtro; });
    if (!items.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = all.length ? 'Nada deste tipo neste dia.' : 'Nada agendado para este dia.';
      lista.appendChild(e);
      return;
    }
    var hoje = selecionado === chave(hojeData());
    var agora = new Date(), nowMin = agora.getHours() * 60 + agora.getMinutes();
    var proximo = null;
    if (hoje) {
      for (var j = 0; j < items.length; j++) {
        if (!items[j].desmarcada && items[j].hora && mins(items[j].hora) + 60 > nowMin) { proximo = items[j]; break; }
      }
    }
    var passado = selecionado < chave(hojeData());
    [['Manhã', 'M'], ['Tarde', 'T'], ['Sem turno definido', null]].forEach(function (g) {
      var grupo = items.filter(function (x) { return x.turno === g[1]; })
        .sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });
      if (!grupo.length) return;
      var sec = document.createElement('section');
      sec.className = 'turno';
      sec.innerHTML = '<h2>' + g[0] + '</h2>';
      var ol = document.createElement('ol');
      ol.className = 'list';
      var comHora = grupo.some(function (x) { return !!x.hora; });
      grupo.forEach(function (x) {
        var past = passado || (hoje && x.hora && mins(x.hora) + 60 <= nowMin);
        var li = document.createElement('li');
        li.className = 'item' + (comHora ? '' : ' nohora') + (past ? ' past' : '') + (x === proximo ? ' next' : '');
        li.innerHTML = (comHora ? '<div class="time">' + (x.hora ? esc(x.hora) : '<span class="none">—</span>') + '</div>' : '') +
          cardHtml(x, abertoId === x.id, x === proximo, admin);
        var head = li.querySelector('button.head');
        if (head) head.addEventListener('click', function () { abertoId = abertoId === x.id ? null : x.id; renderLista(); });
        var pb = li.querySelector('[data-phone]');
        if (pb) pb.addEventListener('click', function () { telVisivel[x.id] = true; renderLista(); });
        var wb = li.querySelector('[data-why]');
        if (wb) wb.addEventListener('click', function () { motivoVisivel[x.id] = true; renderLista(); });
        ol.appendChild(li);
      });
      sec.appendChild(ol);
      lista.appendChild(sec);
    });
  }

  function render() {
    var ini = segunda(semanaOff);
    if (!selecionado || selecionado < chave(ini) || selecionado > chave(somaDias(ini, 6))) {
      selecionado = semanaOff === 0 ? chave(hojeData()) : chave(ini);
    }
    var dh = deChave(selecionado).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('datehead').textContent = dh.charAt(0).toUpperCase() + dh.slice(1);
    renderSemana();
    renderLista();
  }

  function mudaSemana(delta) {
    semanaOff = delta === 0 ? 0 : semanaOff + delta;
    selecionado = null;
    abertoId = null;
    dados = semanas[chave(segunda(semanaOff))] || null;
    render();
    carregar(false);
  }

  // ---------- Eventos ----------
  $('ant').addEventListener('click', function () { mudaSemana(-1); });
  $('prox').addEventListener('click', function () { mudaSemana(1); });
  $('hoje').addEventListener('click', function () { mudaSemana(0); });
  $('atualizar').addEventListener('click', function () { carregar(true); });
  $('sair').addEventListener('click', function () {
    limparSessao();
    telVisivel = {}; motivoVisivel = {};
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) { /* nada */ }
    mostrarLogin('');
  });
  $('filters').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    filtro = b.getAttribute('data-f');
    Array.prototype.forEach.call(this.querySelectorAll('.chip'), function (c) {
      c.setAttribute('aria-pressed', c === b ? 'true' : 'false');
    });
    renderLista();
  });

  // Atualiza sozinho ao voltar para o app e a cada 5 minutos com ele aberto
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && sessao && Date.now() - ultimaCarga > 120000) carregar(true);
  });
  setInterval(function () {
    if (!document.hidden && sessao && Date.now() - ultimaCarga > 300000) carregar(true);
  }, 60000);

  // ---------- Início ----------
  sessao = lerSessao();
  if (sessao && configurado()) { mostrarPrincipal(); render(); carregar(); }
  else mostrarLogin('');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* o app funciona sem */ });
  }
})();
