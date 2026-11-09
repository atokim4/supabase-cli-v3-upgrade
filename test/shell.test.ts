import { describe, expect, it } from "vitest";
import { findInvocations, parseCommand } from "../src/shell.ts";

const parse = (text: string) => findInvocations(text).map((inv) => ({ inv, cmd: parseCommand(inv.args) }));

describe("findInvocations", () => {
  it("finds the CLI behind package runners and env prefixes", () => {
    const text = "npx supabase@latest db push && SUPABASE_YES=1 pnpm exec supabase functions deploy && bunx supabase gen types typescript";
    const found = parse(text);
    expect(found.map((f) => f.cmd.path.join(" "))).toEqual(["db push", "functions deploy", "gen types"]);
    expect(found[1]!.inv.envPrefix.get("SUPABASE_YES")).toBe("1");
  });

  it("ignores prose, other tools and comments", () => {
    expect(parse("echo supabase db push")).toHaveLength(0);
    expect(parse("# supabase db push")).toHaveLength(0);
    expect(parse("uses: supabase/setup-cli@v1")).toHaveLength(0);
    expect(parse("git commit -m 'supabase db push'")).toHaveLength(0);
  });

  it("follows line continuations and stops before redirections", () => {
    const text = "supabase gen types typescript \\\n  --project-id \"$REF\" > src/db.ts 2>&1";
    const [{ inv, cmd }] = parse(text) as [{ inv: ReturnType<typeof findInvocations>[number]; cmd: ReturnType<typeof parseCommand> }];
    expect(cmd.flags.map((f) => [f.name, f.value])).toEqual([["--project-id", "$REF"]]);
    expect(text.slice(inv.binaryToken.start, inv.argsEnd)).toBe("supabase gen types typescript \\\n  --project-id \"$REF\"");
  });

  it("finds commands inside $( ) and keeps ${{ }} in one word", () => {
    const found = parse('URL=$(supabase status -o env | grep API_URL); supabase db push --db-url "${{ secrets.DB_URL }}"');
    expect(found.map((f) => f.cmd.path.join(" "))).toEqual(["status", "db push"]);
    expect(found[1]!.cmd.flags[0]!.value).toBe("${{ secrets.DB_URL }}");
  });

  it("records the command piped in", () => {
    const [found] = parse("echo y | supabase db push");
    expect(found!.inv.pipedFrom?.words).toEqual(["echo", "y"]);
  });

  it("splits command path, positionals and flags", () => {
    const [found] = parse("supabase --workdir app migration repair --linked 20240101000000 --status reverted");
    expect(found!.cmd.path).toEqual(["migration", "repair"]);
    expect(found!.cmd.positionals.map((p) => p.value)).toEqual(["20240101000000"]);
    expect(found!.cmd.flags.map((f) => f.name)).toEqual(["--workdir", "--linked", "--status"]);
  });
});
