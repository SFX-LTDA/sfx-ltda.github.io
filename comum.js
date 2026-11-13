// =====================================================
//  Camada de dados + utilitários compartilhados
//  (Supabase em produção, localStorage no modo demonstração)
// =====================================================
(function () {
  const CFG = window.PONTO_CONFIG || {};
  const DEMO = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY;
  const URL_ATUAL = location.origin + location.pathname;

  // ---------------- Utilitários ----------------
  const U = {
    DEMO,
    esc(s) {
      return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    },
    pad: (n) => String(n).padStart(2, "0"),
    hms(ms) {
      ms = Math.max(0, ms);
      const s = Math.floor(ms / 1000);
      return `${U.pad(Math.floor(s / 3600))}:${U.pad(Math.floor((s % 3600) / 60))}:${U.pad(s % 60)}`;
    },
    hm(ms) {
      ms = Math.max(0, ms);
      const m = Math.round(ms / 60000);
      return `${Math.floor(m / 60)}h ${U.pad(m % 60)}min`;
    },
    horasDec: (ms) => (Math.max(0, ms) / 3600000),
    data: (d) => new Date(d).toLocaleDateString("pt-BR"),
    dataCurta: (d) => new Date(d).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }),
    hora: (d) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    moeda: (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    inicioDia(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; },
    fimDia(d = new Date()) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; },
    inicioSemana(d = new Date()) { const x = U.inicioDia(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; },
    inicioMes(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); },
    paraInputData(d) { const x = new Date(d); return `${x.getFullYear()}-${U.pad(x.getMonth() + 1)}-${U.pad(x.getDate())}`; },
    paraInputDataHora(d) { const x = new Date(d); return `${U.paraInputData(x)}T${U.pad(x.getHours())}:${U.pad(x.getMinutes())}`; },
    // Duração de um registro dentro de um intervalo [de, ate] (expediente aberto conta até agora)
    duracaoNoPeriodo(r, de, ate, agora = Date.now()) {
      const ini = Math.max(new Date(r.entrada).getTime(), de ? new Date(de).getTime() : -Infinity);
      const fimReg = r.saida ? new Date(r.saida).getTime() : agora;
      const fim = Math.min(fimReg, ate ? new Date(ate).getTime() : Infinity);
      return Math.max(0, fim - ini);
    },
    somaPeriodo(regs, de, ate, agora) { return regs.reduce((t, r) => t + U.duracaoNoPeriodo(r, de, ate, agora), 0); },
    mapa: (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`,
    linkLocal(lat, lng, prec) {
      if (lat == null || lng == null) return '<span class="muted">—</span>';
      const alerta = prec && prec > (CFG.PRECISAO_ALERTA_METROS || 150);
      return `<a href="${U.mapa(lat, lng)}" target="_blank" rel="noopener" class="loc ${alerta ? "loc-alerta" : ""}" title="Precisão ±${Math.round(prec || 0)} m">📍 ver mapa${alerta ? " ⚠" : ""}</a>`;
    },
    whatsapp(tel) { const n = String(tel || "").replace(/\D/g, ""); return n ? `https://wa.me/${n.length <= 11 ? "55" + n : n}` : "#"; },
    toast(msg, tipo = "ok") {
      let box = document.getElementById("toasts");
      if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
      const t = document.createElement("div");
      t.className = `toast toast-${tipo}`;
      t.textContent = msg;
      box.appendChild(t);
      setTimeout(() => t.classList.add("sai"), 3800);
      setTimeout(() => t.remove(), 4300);
    },
    obterLocalizacao() {
      return new Promise((resolve, reject) => {
        if (!("geolocation" in navigator)) return reject(new Error("Este aparelho/navegador não suporta GPS."));
        if (!window.isSecureContext) return reject(new Error("O GPS só funciona em site seguro (https://)."));
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy }),
          (e) => {
            const msgs = {
              1: "Permissão de localização negada. Toque no cadeado ao lado do endereço do site, permita a Localização e tente de novo.",
              2: "Não foi possível obter sua localização. Ative o GPS do celular e tente novamente.",
              3: "O GPS demorou para responder. Vá para um local mais aberto e tente novamente.",
            };
            reject(new Error(msgs[e.code] || "Erro ao obter localização."));
          },
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );
      });
    },
    traduzErro(e) {
      const m = (e && (e.message || e.error_description || e)) + "";
      if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
      if (/Email not confirmed/i.test(m)) return "Seu e-mail ainda não foi confirmado. Abra o link que enviamos para sua caixa de entrada (veja também o spam).";
      if (/already registered|already exists/i.test(m)) return "Este e-mail já está cadastrado. Use a opção Entrar.";
      if (/Password should be at least/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
      if (/rate limit|too many/i.test(m)) return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.";
      if (/Failed to fetch|NetworkError/i.test(m)) return "Sem conexão com a internet. Verifique e tente de novo.";
      return m;
    },
  };

  // ---------------- Implementação Supabase ----------------
  function criarSupabase() {
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const ok = ({ data, error }) => { if (error) throw error; return data; };
    const umDiaAntes = (d) => new Date(new Date(d).getTime() - 86400000).toISOString();

    return {
      async cadastrar({ nome, nascimento, telefone, email, senha }) {
        const { data, error } = await sb.auth.signUp({
          email, password: senha,
          options: { emailRedirectTo: URL_ATUAL, data: { nome, nascimento, telefone } },
        });
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
          throw new Error("Este e-mail já está cadastrado. Use a opção Entrar.");
        return true;
      },
      async entrar(email, senha) { ok(await sb.auth.signInWithPassword({ email, password: senha })); return this.sessao(); },
      async sair() { await sb.auth.signOut(); },
      async sessao() {
        const { data } = await sb.auth.getSession();
        const user = data.session && data.session.user;
        if (!user) return null;
        const perfil = ok(await sb.from("perfis").select("*").eq("id", user.id).maybeSingle());
        return perfil ? { user, perfil } : null;
      },
      async expedienteAberto(uid) {
        return ok(await sb.from("registros").select("*").eq("usuario_id", uid).is("saida", null).maybeSingle());
      },
      async meusRegistros(uid, desde) {
        return ok(await sb.from("registros").select("*").eq("usuario_id", uid).gte("entrada", umDiaAntes(desde)).order("entrada", { ascending: false }));
      },
      async registrar(tipo, pos) {
        return ok(await sb.rpc("registrar_ponto", { p_tipo: tipo, p_lat: pos.lat, p_lng: pos.lng, p_precisao: pos.precisao }));
      },
      async enviarRecuperacao(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: URL_ATUAL })); },
      async definirSenha(senha) { ok(await sb.auth.updateUser({ password: senha })); },
      aoRecuperarSenha(cb) { sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") cb(); }); },
      // ----- gestor -----
      async listarPerfis() { return ok(await sb.from("perfis").select("*").order("nome")); },
      async atualizarPerfil(id, campos) { ok(await sb.from("perfis").update(campos).eq("id", id)); },
      async listarRegistros(de, ate) {
        // inclui expedientes ainda abertos iniciados antes do período
        const [a, b] = await Promise.all([
          sb.from("registros").select("*").gte("entrada", umDiaAntes(de)).lte("entrada", new Date(ate).toISOString()).order("entrada", { ascending: false }),
          sb.from("registros").select("*").is("saida", null),
        ]);
        const lista = ok(a), abertos = ok(b);
        const ids = new Set(lista.map((r) => r.id));
        abertos.forEach((r) => { if (!ids.has(r.id)) lista.push(r); });
        return lista;
      },
      async ajustarRegistro(id, campos) { ok(await sb.from("registros").update({ ...campos, ajustado: true }).eq("id", id)); },
      async excluirRegistro(id) { ok(await sb.from("registros").delete().eq("id", id)); },
      aoMudar(cb) {
        sb.channel("ponto-mudancas")
          .on("postgres_changes", { event: "*", schema: "public", table: "registros" }, cb)
          .on("postgres_changes", { event: "*", schema: "public", table: "perfis" }, cb)
          .subscribe();
      },
    };
  }

  // ---------------- Implementação DEMONSTRAÇÃO (localStorage) ----------------
  function criarDemo() {
    const CH = "ponto_demo_db_v1", SES = "ponto_demo_sessao";
    const uid = () => "u" + Math.random().toString(36).slice(2, 10);
    const ler = () => JSON.parse(localStorage.getItem(CH) || "null") || semear();
    const gravar = (db) => localStorage.setItem(CH, JSON.stringify(db));
    const espera = (ms = 250) => new Promise((r) => setTimeout(r, ms));

    function semear() {
      const base = { lat: 0.0349, lng: -51.0694 };
      const p = (o) => ({ nascimento: "1995-05-10", telefone: "96991234567", papel: "funcionario", status: "aprovado", email_confirmado: true, criado_em: new Date().toISOString(), ...o });
      const usuarios = [
        { id: "gestor", senha: "gestor123", perfil: p({ id: "gestor", nome: "Gestor", email: "gestor@demo.com", papel: "gestor" }) },
        { id: "f1", senha: "123456", perfil: p({ id: "f1", nome: "Ana Souza", email: "ana@demo.com", valor_hora: 25 }) },
        { id: "f2", senha: "123456", perfil: p({ id: "f2", nome: "Bruno Lima", email: "bruno@demo.com", valor_hora: 22 }) },
        { id: "f3", senha: "123456", perfil: p({ id: "f3", nome: "Carla Mendes", email: "carla@demo.com", valor_hora: 28 }) },
        { id: "f4", senha: "123456", perfil: p({ id: "f4", nome: "Diego Rocha", email: "diego@demo.com", valor_hora: 20 }) },
        { id: "f5", senha: "123456", perfil: p({ id: "f5", nome: "Lucas Pereira", email: "lucas@demo.com", status: "pendente", valor_hora: 0 }) },
      ];
      const registros = [];
      let id = 1;
      const jit = () => (Math.random() - 0.5) * 0.004;
      const hoje = U.inicioDia();
      for (let d = 24; d >= 0; d--) {
        const dia = new Date(hoje); dia.setDate(dia.getDate() - d);
        if (dia.getDay() === 0) continue;
        ["f1", "f2", "f3", "f4"].forEach((u, i) => {
          if (d > 0 && Math.random() < 0.12) return; // faltas aleatórias
          const ent = new Date(dia); ent.setHours(7 + (i % 2), Math.floor(Math.random() * 50), 0, 0);
          const dur = (dia.getDay() === 6 ? 4 : 8) * 3600000 + Math.floor((Math.random() - 0.3) * 3600000);
          let sai = new Date(ent.getTime() + dur);
          if (d === 0) {
            if (ent.getTime() > Date.now()) { ent.setTime(Date.now() - (i + 1) * 47 * 60000); }
            if (u === "f1" || u === "f3" || sai.getTime() > Date.now()) sai = null; // em expediente
          }
          registros.push({
            id: id++, usuario_id: u, entrada: ent.toISOString(),
            entrada_lat: base.lat + jit(), entrada_lng: base.lng + jit(), entrada_precisao: 8 + Math.random() * 20,
            saida: sai && sai.toISOString(), saida_lat: sai && base.lat + jit(), saida_lng: sai && base.lng + jit(),
            saida_precisao: sai && 8 + Math.random() * 20, ajustado: false, obs: null, criado_em: ent.toISOString(),
          });
        });
      }
      const db = { usuarios, registros, proxId: id };
      gravar(db);
      return db;
    }
    const perfilDe = (db, id) => (db.usuarios.find((u) => u.id === id) || {}).perfil;
    const avisar = () => window.dispatchEvent(new Event("ponto-demo-mudou"));

    return {
      async cadastrar({ nome, nascimento, telefone, email, senha }) {
        await espera();
        const db = ler();
        if (db.usuarios.some((u) => u.perfil.email.toLowerCase() === email.toLowerCase())) throw new Error("Este e-mail já está cadastrado. Use a opção Entrar.");
        if ((senha || "").length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
        const id = uid();
        db.usuarios.push({ id, senha, perfil: { id, nome, nascimento, telefone, email, papel: "funcionario", status: "pendente", valor_hora: 0, email_confirmado: true, criado_em: new Date().toISOString() } });
        gravar(db); avisar();
        return true;
      },
      async entrar(email, senha) {
        await espera();
        const u = ler().usuarios.find((x) => x.perfil.email.toLowerCase() === email.toLowerCase() && x.senha === senha);
        if (!u) throw new Error("E-mail ou senha incorretos.");
        localStorage.setItem(SES, u.id);
        return this.sessao();
      },
      async sair() { localStorage.removeItem(SES); },
      async sessao() {
        const id = localStorage.getItem(SES);
        const perfil = id && perfilDe(ler(), id);
        return perfil ? { user: { id }, perfil: { ...perfil } } : null;
      },
      async expedienteAberto(uid) { return ler().registros.find((r) => r.usuario_id === uid && !r.saida) || null; },
      async meusRegistros(uid, desde) {
        const lim = new Date(desde).getTime() - 86400000;
        return ler().registros.filter((r) => r.usuario_id === uid && new Date(r.entrada).getTime() >= lim).sort((a, b) => b.entrada.localeCompare(a.entrada));
      },
      async registrar(tipo, pos) {
        await espera(400);
        const db = ler(); const id = localStorage.getItem(SES); const perfil = perfilDe(db, id);
        if (!perfil || perfil.status !== "aprovado") throw new Error("Seu cadastro não está autorizado pelo gestor.");
        const aberto = db.registros.find((r) => r.usuario_id === id && !r.saida);
        const agora = new Date().toISOString();
        let reg;
        if (tipo === "entrada") {
          if (aberto) throw new Error("Você já tem um expediente aberto. Registre a saída primeiro.");
          reg = { id: db.proxId++, usuario_id: id, entrada: agora, entrada_lat: pos.lat, entrada_lng: pos.lng, entrada_precisao: pos.precisao, saida: null, ajustado: false, criado_em: agora };
          db.registros.push(reg);
        } else {
          if (!aberto) throw new Error("Não há expediente aberto para registrar saída.");
          Object.assign(aberto, { saida: agora, saida_lat: pos.lat, saida_lng: pos.lng, saida_precisao: pos.precisao });
          reg = aberto;
        }
        gravar(db); avisar();
        return reg;
      },
      async enviarRecuperacao() { await espera(); },
      async definirSenha() { await espera(); },
      aoRecuperarSenha() {},
      async listarPerfis() { return ler().usuarios.map((u) => ({ ...u.perfil })).sort((a, b) => a.nome.localeCompare(b.nome)); },
      async atualizarPerfil(id, campos) { const db = ler(); Object.assign(perfilDe(db, id), campos); gravar(db); avisar(); },
      async listarRegistros(de, ate) {
        const a = new Date(de).getTime() - 86400000, b = new Date(ate).getTime();
        return ler().registros.filter((r) => { const t = new Date(r.entrada).getTime(); return (t >= a && t <= b) || !r.saida; }).sort((x, y) => y.entrada.localeCompare(x.entrada));
      },
      async ajustarRegistro(id, campos) { const db = ler(); Object.assign(db.registros.find((r) => r.id === id), campos, { ajustado: true }); gravar(db); avisar(); },
      async excluirRegistro(id) { const db = ler(); db.registros = db.registros.filter((r) => r.id !== id); gravar(db); avisar(); },
      aoMudar(cb) {
        window.addEventListener("ponto-demo-mudou", cb);
        window.addEventListener("storage", (e) => { if (e.key === CH) cb(); }); // outra aba
      },
      resetarDemo() { localStorage.removeItem(CH); localStorage.removeItem(SES); location.reload(); },
    };
  }

  window.U = U;
  window.API = DEMO ? criarDemo() : criarSupabase();

  // Faixa de aviso do modo demonstração
  if (DEMO) {
    document.addEventListener("DOMContentLoaded", () => {
      const b = document.createElement("div");
      b.className = "faixa-demo";
      b.innerHTML = 'MODO DEMONSTRAÇÃO — os dados ficam só neste navegador. <button type="button" id="btnResetDemo">reiniciar dados</button>';
      document.body.prepend(b);
      document.getElementById("btnResetDemo").onclick = () => window.API.resetarDemo();
    });
  }
})();
