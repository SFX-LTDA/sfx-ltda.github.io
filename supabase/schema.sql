-- =====================================================================
--  PONTO ELETRÔNICO — Estrutura do banco de dados (Supabase / Postgres)
--  Cole TODO este arquivo no Supabase: SQL Editor > New query > Run
-- =====================================================================

-- ---------- Tabela de perfis (1 por usuário) ----------
create table if not exists public.perfis (
  id               uuid primary key references auth.users(id) on delete cascade,
  nome             text not null,
  nascimento       date,
  telefone         text,
  email            text not null,
  papel            text not null default 'funcionario' check (papel in ('funcionario','gestor')),
  status           text not null default 'pendente'
                   check (status in ('pendente','aprovado','recusado','bloqueado')),
  valor_hora       numeric(10,2) not null default 0,
  email_confirmado boolean not null default false,
  criado_em        timestamptz not null default now()
);

-- ---------- Tabela de registros de ponto (1 linha = 1 expediente) ----------
create table if not exists public.registros (
  id               bigint generated always as identity primary key,
  usuario_id       uuid not null references public.perfis(id) on delete cascade,
  entrada          timestamptz not null default now(),
  entrada_lat      double precision,
  entrada_lng      double precision,
  entrada_precisao double precision,
  saida            timestamptz,
  saida_lat        double precision,
  saida_lng        double precision,
  saida_precisao   double precision,
  ajustado         boolean not null default false,
  obs              text,
  criado_em        timestamptz not null default now()
);
create index if not exists registros_usuario_entrada on public.registros (usuario_id, entrada desc);
-- Garante no máximo 1 expediente aberto por pessoa
create unique index if not exists um_expediente_aberto on public.registros (usuario_id) where saida is null;

-- ---------- Função auxiliar: o usuário logado é gestor? ----------
create or replace function public.eh_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'gestor');
$$;

-- ---------- Cria o perfil automaticamente no cadastro ----------
create or replace function public.novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, nascimento, telefone, email, email_confirmado)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nome', ''), new.email),
    nullif(new.raw_user_meta_data->>'nascimento', '')::date,
    new.raw_user_meta_data->>'telefone',
    new.email,
    new.email_confirmed_at is not null
  );
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.novo_usuario();

-- ---------- Marca no perfil quando o e-mail é confirmado ----------
create or replace function public.sincroniza_email_confirmado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.perfis set email_confirmado = (new.email_confirmed_at is not null) where id = new.id;
  return new;
end $$;

drop trigger if exists ao_confirmar_email on auth.users;
create trigger ao_confirmar_email after update of email_confirmed_at on auth.users
  for each row execute function public.sincroniza_email_confirmado();

-- ---------- Registro de ponto (horário vem do SERVIDOR, não do celular) ----------
create or replace function public.registrar_ponto(
  p_tipo text, p_lat double precision, p_lng double precision, p_precisao double precision
) returns public.registros
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_reg    public.registros;
begin
  if auth.uid() is null then raise exception 'Sessão expirada. Entre novamente.'; end if;

  select status into v_status from public.perfis where id = auth.uid();
  if v_status is distinct from 'aprovado' then
    raise exception 'Seu cadastro não está autorizado pelo gestor.';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'A localização (GPS) é obrigatória para registrar o ponto.';
  end if;

  select * into v_reg from public.registros
   where usuario_id = auth.uid() and saida is null
   for update;

  if p_tipo = 'entrada' then
    if found then raise exception 'Você já tem um expediente aberto. Registre a saída primeiro.'; end if;
    insert into public.registros (usuario_id, entrada, entrada_lat, entrada_lng, entrada_precisao)
    values (auth.uid(), now(), p_lat, p_lng, p_precisao)
    returning * into v_reg;
  elsif p_tipo = 'saida' then
    if not found then raise exception 'Não há expediente aberto para registrar saída.'; end if;
    update public.registros
       set saida = now(), saida_lat = p_lat, saida_lng = p_lng, saida_precisao = p_precisao
     where id = v_reg.id
    returning * into v_reg;
  else
    raise exception 'Tipo de registro inválido.';
  end if;

  return v_reg;
end $$;

revoke all on function public.registrar_ponto(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.registrar_ponto(text, double precision, double precision, double precision) to authenticated;

-- ---------- Segurança (Row Level Security) ----------
alter table public.perfis    enable row level security;
alter table public.registros enable row level security;

drop policy if exists perfis_ler       on public.perfis;
drop policy if exists perfis_gestor    on public.perfis;
drop policy if exists registros_ler    on public.registros;
drop policy if exists registros_gestor_upd on public.registros;
drop policy if exists registros_gestor_del on public.registros;

-- Funcionário vê só o próprio perfil; gestor vê todos
create policy perfis_ler on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_gestor());
-- Só o gestor altera perfis (aprovar, bloquear, valor/hora)
create policy perfis_gestor on public.perfis for update to authenticated
  using (public.eh_gestor()) with check (public.eh_gestor());

-- Funcionário vê só os próprios registros; gestor vê todos
create policy registros_ler on public.registros for select to authenticated
  using (usuario_id = auth.uid() or public.eh_gestor());
-- Só o gestor corrige ou apaga registros. Inserção só pela função registrar_ponto.
create policy registros_gestor_upd on public.registros for update to authenticated
  using (public.eh_gestor()) with check (public.eh_gestor());
create policy registros_gestor_del on public.registros for delete to authenticated
  using (public.eh_gestor());

-- Impede que o próprio funcionário altere papel/status mesmo por outros caminhos
revoke insert, update, delete on public.perfis from anon, authenticated;
grant  select on public.perfis to authenticated;
grant  update (status, valor_hora, nome, telefone) on public.perfis to authenticated;
revoke insert on public.registros from anon, authenticated;
grant  select, update, delete on public.registros to authenticated;

-- ---------- Tempo real (painel do gestor atualiza sozinho) ----------
do $$
begin
  begin alter publication supabase_realtime add table public.registros; exception when others then null; end;
  begin alter publication supabase_realtime add table public.perfis;    exception when others then null; end;
end $$;

-- =====================================================================
--  DEPOIS de criar o usuário do gestor em Authentication > Users,
--  rode a linha abaixo trocando o e-mail (ver LEIA-ME):
--
--  update public.perfis set papel = 'gestor', status = 'aprovado', nome = 'Gestor'
--   where email = 'SEU-EMAIL-DE-GESTOR@exemplo.com';
-- =====================================================================
