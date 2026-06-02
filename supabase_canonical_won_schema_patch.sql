alter table if exists public.ml_decisions
    add column if not exists canonical_won boolean;

alter table if exists public.ml_features
    add column if not exists canonical_won boolean,
    add column if not exists outcome_h2 smallint;

alter table if exists public.ml_recommendation_outcomes
    add column if not exists canonical_won smallint;

alter table if exists public.ml_evaluation_outcomes
    add column if not exists canonical_won smallint;

alter table if exists public.trades_v2
    add column if not exists canonical_won boolean,
    add column if not exists outcome_h2 smallint;

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'ml_decisions' and column_name = 'outcome_h2'
    ) then
        execute $sql$
            update public.ml_decisions
            set canonical_won = case
                when canonical_won is not null then canonical_won
                when outcome_h2 = 1 then true
                when outcome_h2 = 0 then false
                when won = true then true
                when won = false then false
                else null
            end
            where canonical_won is null
        $sql$;
    else
        execute $sql$
            update public.ml_decisions
            set canonical_won = case
                when canonical_won is not null then canonical_won
                when won = true then true
                when won = false then false
                else null
            end
            where canonical_won is null
        $sql$;
    end if;
end $$;

do $$
begin
    execute $sql$
        update public.ml_features
        set canonical_won = case
                when canonical_won is not null then canonical_won
                when outcome_h2 = 1 then true
                when outcome_h2 = 0 then false
                when won = true then true
                when won = false then false
                else null
            end,
            outcome_h2 = case
                when outcome_h2 is not null then outcome_h2
                when canonical_won = true then 1
                when canonical_won = false then 0
                when won = true then 1
                when won = false then 0
                else null
            end
        where canonical_won is null
           or outcome_h2 is null
    $sql$;
end $$;

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'ml_recommendation_outcomes' and column_name = 'outcome_h2'
    ) then
        execute $sql$
            update public.ml_recommendation_outcomes
            set canonical_won = case
                when canonical_won is not null then canonical_won
                when outcome_h2 in (0, 1) then outcome_h2
                when won = true then 1
                when won = false then 0
                else null
            end
            where canonical_won is null
        $sql$;
    else
        execute $sql$
            update public.ml_recommendation_outcomes
            set canonical_won = case
                when canonical_won is not null then canonical_won
                when won = true then 1
                when won = false then 0
                else null
            end
            where canonical_won is null
        $sql$;
    end if;
end $$;

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'ml_evaluation_outcomes' and column_name = 'outcome_h2'
    ) then
        execute $sql$
            update public.ml_evaluation_outcomes
            set canonical_won = case
                when canonical_won is not null then canonical_won
                when outcome_h2 in (0, 1) then outcome_h2
                when won = true then 1
                when won = false then 0
                else null
            end
            where canonical_won is null
        $sql$;
    else
        execute $sql$
            update public.ml_evaluation_outcomes
            set canonical_won = case
                when canonical_won is not null then canonical_won
                when won = true then 1
                when won = false then 0
                else null
            end
            where canonical_won is null
        $sql$;
    end if;
end $$;

do $$
begin
    execute $sql$
        update public.trades_v2
        set canonical_won = case
                when canonical_won is not null then canonical_won
                when outcome_h2 = 1 then true
                when outcome_h2 = 0 then false
                when actual_pnl > 0 then true
                when actual_pnl < 0 then false
                else null
            end,
            outcome_h2 = case
                when outcome_h2 is not null then outcome_h2
                when canonical_won = true then 1
                when canonical_won = false then 0
                when actual_pnl > 0 then 1
                when actual_pnl < 0 then 0
                else null
            end
        where canonical_won is null
           or outcome_h2 is null
    $sql$;
end $$;

create index if not exists idx_ml_decisions_canonical_won
    on public.ml_decisions (canonical_won);

create index if not exists idx_ml_features_canonical_won
    on public.ml_features (canonical_won);

create index if not exists idx_ml_recommendation_outcomes_canonical_won
    on public.ml_recommendation_outcomes (canonical_won);

create index if not exists idx_ml_evaluation_outcomes_canonical_won
    on public.ml_evaluation_outcomes (canonical_won);

create index if not exists idx_trades_v2_canonical_won
    on public.trades_v2 (canonical_won);
