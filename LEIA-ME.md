# Ponto Eletrônico — guia de implantação

Sistema de ponto com cadastro, autorização pelo gestor, registro de entrada/saída com GPS e painel em tempo real.
Custo: **R$ 0** (Supabase gratuito + Netlify gratuito). Tempo de implantação: ~30 minutos.

## O que tem na pasta

| Arquivo | Para que serve |
|---|---|
| `index.html` | Página do **funcionário** (cadastro, login, registrar entrada/saída) |
| `gestor.html` | Página do **gestor** (painel, registros, autorizações, valores a pagar) |
| `config.js` | **Único arquivo que você edita** (nome da empresa + chaves do Supabase) |
| `comum.js`, `estilo.css` | Código e visual compartilhados (não precisa mexer) |
| `supabase/schema.sql` | Estrutura do banco de dados (colar no Supabase uma vez) |

---

## Passo 0 — Ver funcionando antes (opcional, 2 min)

Com o `config.js` ainda em branco, o sistema roda em **modo demonstração** (dados fictícios, salvos só no navegador).
Publique a pasta como no Passo 5 (ou abra o `index.html` no Chrome) e teste:

- Gestor: abra `gestor.html` → `gestor@demo.com` / `gestor123`
- Funcionário: abra `index.html` → `ana@demo.com` / `123456` (ou crie um cadastro novo e autorize pelo gestor)

---

## Passo 1 — Criar o banco de dados (Supabase)

1. Crie uma conta em **supabase.com** e clique em **New project**.
   - Região: **South America (São Paulo)**.
   - Guarde a senha do banco (não será usada no sistema, mas guarde).
2. No menu lateral, abra **SQL Editor** → **New query**.
3. Abra o arquivo `supabase/schema.sql`, copie **tudo**, cole e clique em **Run**. Deve aparecer "Success".

## Passo 2 — Ligar a confirmação de e-mail

1. Menu **Authentication** → **Sign In / Providers** (ou *Providers*) → **Email**.
2. Deixe **ligado** o "Confirm email". Salve.
3. (Recomendado) **Authentication → Email Templates → Confirm signup**: troque o texto para português, por exemplo:

   **Assunto:** `Confirme seu cadastro no ponto eletrônico`
   **Mensagem:**
   ```html
   <h2>Confirme seu e-mail</h2>
   <p>Toque no botão abaixo para confirmar seu cadastro. Depois disso, aguarde a autorização do gestor.</p>
   <p><a href="{{ .ConfirmationURL }}">Confirmar meu e-mail</a></p>
   ```
   Faça o mesmo em **Reset Password** (recuperação de senha), se quiser.

## Passo 3 — Criar o login do gestor (só você)

1. **Authentication → Users → Add user → Create new user**.
2. Informe seu e-mail e uma senha forte. Marque **Auto Confirm User**. Crie.
3. Volte ao **SQL Editor** e rode (troque pelo seu e-mail):
   ```sql
   update public.perfis set papel = 'gestor', status = 'aprovado', nome = 'Gestor'
    where email = 'seu-email@exemplo.com';
   ```
   Pronto: só essa conta acessa o painel. Ninguém consegue virar gestor pelo site.

## Passo 4 — Colocar as chaves no `config.js`

1. No Supabase: **Project Settings → API** (ou *Data API / API Keys*).
2. Copie a **Project URL** e a chave **anon / public** (às vezes chamada *publishable*).
   ⚠️ **Nunca** use a chave `service_role` / *secret* no site.
3. Edite o `config.js`:
   ```js
   NOME_EMPRESA: "Silva & Silva",
   SUPABASE_URL: "https://xxxxxxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi...",
   ```

## Passo 5 — Publicar o site (online 24h)

**Jeito mais fácil — Netlify Drop:**
1. Acesse **app.netlify.com/drop** (crie conta grátis).
2. **Arraste a pasta inteira** para a página. Em segundos o site fica no ar com `https://` (obrigatório para o GPS funcionar).
3. Em **Site configuration → Change site name**, escolha um nome, ex.: `ponto-silva`.
4. Para atualizar depois (ex.: mudou o `config.js`): aba **Deploys** → arraste a pasta de novo.

Seus links ficam:
- **Funcionários:** `https://ponto-silva.netlify.app/` → fixe no grupo do WhatsApp
- **Gestor:** `https://ponto-silva.netlify.app/gestor.html` → só para você (não divulgue)

## Passo 6 — Avisar o Supabase qual é o endereço do site

**Authentication → URL Configuration:**
- **Site URL:** `https://ponto-silva.netlify.app`
- **Redirect URLs:** adicione `https://ponto-silva.netlify.app/**`

Sem isso, o link de confirmação do e-mail não volta para o seu site.

---

## Como funciona no dia a dia

**Funcionário**
1. Primeiro acesso: abre o link → *Cadastre-se* → confirma o e-mail → aguarda você autorizar.
2. Todo dia: abre o link → entra com e-mail e senha → **Registrar entrada** → o celular pergunta se pode usar a localização → *Permitir*.
3. Ao terminar: **Registrar saída** (pede o GPS de novo).
- A sessão fica salva no celular, então nos dias seguintes normalmente ele já cai direto na tela do ponto.
- Ele vê o contador do expediente e as horas do dia, da semana e do mês.

**Gestor (você)**
- **Funcionários:** autoriza/recusa cadastros, define o **valor/hora** de cada um, bloqueia acesso.
- **Painel:** quem está em expediente agora (contador ao vivo), mapa de hoje, horas e **valor a pagar** por funcionário (hoje / semana / mês / mês anterior), gráfico dos últimos 14 dias. Atualiza sozinho.
- **Registros:** filtra por pessoa e período, abre a localização de cada entrada/saída no Google Maps, **ajusta** registros (ex.: esqueceu de bater a saída — o ajuste fica marcado e exige motivo) e **exporta a planilha** (abre no Excel/Google Planilhas) para fechar o pagamento.

## Proteções já incluídas

- O **horário vem do servidor**, não do celular — mudar a hora do aparelho não adianta.
- Sem GPS o ponto **não é registrado**. GPS com precisão ruim (acima de 150 m, ajustável no `config.js`) aparece com ⚠ no painel.
- Funcionário só vê os próprios registros; não consegue editar nem apagar nada.
- Não dá para registrar duas entradas seguidas nem saída sem entrada.
- Expediente que passa da meia-noite é contado corretamente.

## Limites e cuidados

- **E-mails:** o envio padrão do Supabase tem limite baixo por hora — suficiente para 4 pessoas. Se crescer, configure um SMTP próprio em *Authentication → Emails → SMTP*.
- **Plano gratuito do Supabase** pode pausar projetos sem uso por alguns dias; com uso diário isso não acontece. Se pausar, basta reativar no painel.
- **GPS falso:** apps de "localização falsa" existem no Android. A precisão e o mapa ajudam a perceber algo estranho, mas nenhum sistema web impede 100%.
- **LGPD:** avise os prestadores, por escrito, que a localização é coletada **apenas no momento** da entrada e da saída, para fins de controle de horas e pagamento.
- **Prestadores PJ:** controle rígido de jornada (horário fixo, subordinação) é um dos elementos que a Justiça do Trabalho analisa ao avaliar vínculo empregatício. Vale alinhar com seu contador/advogado como apresentar o controle (ex.: "registro de horas para faturamento") no contrato.
