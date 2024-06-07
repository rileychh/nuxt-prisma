import {
  defineNuxtModule,
  addPlugin,
  createResolver,
  addImportsDir,
  addServerScanDir,
} from "@nuxt/kit";
import { execa } from "execa";
import { fileURLToPath } from "url";
import defu from "defu";
import fs from "fs";
import prompts from "prompts";
import chalk from "chalk";
import type { PrismaExtendedModule } from "./runtime/types/prisma-module";

export default defineNuxtModule<PrismaExtendedModule>({
  meta: {
    name: "@prisma/nuxt",
    configKey: "prisma",
  },
  // Default configuration options of the Nuxt module
  defaults: {
    datasourceUrl: process.env.DATABASE_URL,
    log: [],
    errorFormat: "colorless",
    installCli: true,
    initPrisma: true,
    writeToSchema: true,
    formatSchema: true,
    runMigration: true,
    installClient: true,
    generateClient: true,
    installStudio: true,
    skipInstallations: false,
    autoSetupPrisma: false,
  },
  async setup(options, nuxt) {
    const { resolve: resolveProject } = createResolver(nuxt.options.rootDir);
    const { resolve: resolver } = createResolver(import.meta.url);
    const runtimeDir = fileURLToPath(new URL("./runtime", import.meta.url));

    // Identifies which script is running: posinstall, dev or prod
    const npm_lifecycle_event = import.meta.env.npm_lifecycle_event;

    const force_skip_prisma_setup =
      (import.meta.env.SKIP_PRISMA_SETUP ?? false) ||
      npm_lifecycle_event === "test";

    // exposing module options to application runtime
    nuxt.options.runtimeConfig.public.prisma = defu(
      nuxt.options.runtimeConfig.public.prisma || {},
      {
        log: options.log,
        errorFormat: options.errorFormat,
      },
    );

    // Enable server components for Nuxt
    nuxt.options.experimental.componentIslands ||= {};
    nuxt.options.experimental.componentIslands = true;

    function success(message: string) {
      console.log(chalk.green(`✔ ${message}`));
    }

    function error(message: string) {
      console.error(chalk.red(`✘ ${message}`));
    }

    async function detectCli() {
      await execa("prisma", ["version"], { cwd: resolveProject() });
    }

    async function installCli() {
      if (options.installCli) {
        try {
          await execa("npm", ["install", "prisma", "--save-dev"], {
            cwd: resolveProject(),
          });
        } catch {
          error("Failed to install Prisma CLI.");
        }
      }
    }

    async function initPrisma() {
      if (options.initPrisma) {
        try {
          const { stdout: initializePrisma } = await execa(
            "npx",
            ["prisma", "init", "--datasource-provider", "sqlite"],
            { cwd: resolveProject() },
          );
          console.log(initializePrisma);
        } catch {
          error("Failed to initialize Prisma project.");
        }
      }
    }

    async function writeToSchema() {
      if (options.writeToSchema) {
        try {
          const prismaSchemaPath = resolveProject("prisma", "schema.prisma");
          let existingSchema = "";

          try {
            existingSchema = fs.readFileSync(prismaSchemaPath, "utf-8");
          } catch {
            error("Error reading existing schema file");
          }

          const addModel = `
            model User {
              id    Int     @id @default(autoincrement())
              email String  @unique
              name  String?
              posts Post[]
            }

            model Post {
              id        Int     @id @default(autoincrement())
              title     String
              content   String?
              published Boolean @default(false)
              author    User    @relation(fields: [authorId], references: [id])
              authorId  Int
            }
          `;
          const updatedSchema = `${existingSchema.trim()}\n\n${addModel}`;

          fs.writeFileSync(prismaSchemaPath, updatedSchema);
        } catch {
          error("Failed to write model to Prisma schema.");
        }
      }
    }

    async function formatSchema() {
      if (options.formatSchema) {
        try {
          await execa("npx", ["prisma", "format"], { cwd: resolveProject() });
        } catch {
          error("Failed to format Prisma schema file.");
        }
      }
    }

    async function runMigration() {
      if (options.runMigration) {
        try {
          await execa("npx", ["prisma", "migrate", "dev", "--name", "init"], {
            cwd: resolveProject(),
          });
          success("Created User and Post tables in your SQLite database.");
        } catch {
          error("Failed to run Prisma migration.");
        }
      }
    }

    async function generateClient() {
      if (options.installClient && options.generateClient) {
        try {
          await execa("npm", ["install", "@prisma/client"], {
            cwd: resolveProject(),
          });
          const { stdout: generateClient } = await execa(
            "npx",
            ["prisma", "generate"],
            { cwd: resolveProject() },
          );
          console.log(generateClient);
        } catch {
          error("Failed to generate Prisma Client.");
        }
      }
    }

    async function installStudio() {
      if (options.installStudio) {
        try {
          const { spawn } = require("child_process");
          await spawn("npx", ["prisma", "studio", "--browser", "none"], {
            cwd: resolveProject(),
          });
          success(`Prisma Studio installed. After clicking 'Get Started' in Nuxt DevTools,
  click on the three dots in the lower left-hand side to reveal additional tabs.
  Locate the Prisma logo to open Prisma Studio.`);
        } catch {
          error("Failed to install Prisma Studio.");
        }
      }
    }

    async function promptCli() {
      if (options.autoSetupPrisma) {
        await installCli();
        success("Prisma CLI successfully installed.");
        return;
      }

      try {
        await detectCli();
        success("Prisma CLI is installed.");
        return;
      } catch {
        error("Prisma CLI is not installed.");
      }
      const response = await prompts({
        type: "confirm",
        name: "installPrisma",
        message: "Do you want to install Prisma CLI?",
        initial: true,
      });

      if (response?.installPrisma === true) {
        await installCli();
        success("Prisma CLI successfully installed.");
      } else {
        console.log("Prisma CLI installation skipped.");
      }
    }

    async function promptInitPrisma() {
      //check if prisma schema exists
      const schemaExists = fs.existsSync(
        resolveProject("prisma", "schema.prisma"),
      );
      if (schemaExists) {
        success("Prisma schema file exists.");
        console.log(`Please make sure to: \n 1. Set the DATABASE_URL in the \`.env\` file to point to your existing database. If your database has no tables yet, read https://pris.ly/d/getting-started
        \n 2. Set the provider of the datasource block in \`schema.prisma\` to match your database: postgresql, mysql, sqlite, sqlserver, mongodb, or cockroachdb.
        \n 3. Run prisma db pull to turn your database schema into a Prisma schema.`);
      } else {
        console.log("Prisma schema file does not exist.");
      }

      if (schemaExists === false) {
        if (options.autoSetupPrisma) {
          await initPrisma();
          await writeToSchema();
          await formatSchema();
          return;
        }

        const response = await prompts({
          type: "confirm",
          name: "initPrisma",
          message: "Do you want to initialize Prisma ORM?",
          initial: true,
        });

        if (response?.initPrisma === true) {
          await initPrisma();
          await writeToSchema();
          await formatSchema();
        } else {
          console.log("Prisma initialization skipped.");
        }
      }
    }

    async function promptRunMigration() {
      if (options.autoSetupPrisma) {
        await runMigration();
        return;
      }

      const response = await prompts({
        type: "confirm",
        name: "runMigration",
        message:
          "Do you want to migrate your database by creating database tables based on your Prisma schema?",
        initial: true,
      });

      if (response?.runMigration === true) {
        try {
          await runMigration();
        } catch (e: any) {
          error(e);
        }
      } else {
        console.log("Prisma Migrate skipped.");
      }
    }

    async function promptGenerateClient() {
      if (options.autoSetupPrisma) {
        try {
          await generateClient();
        } catch (e: any) {
          error(e);
        }
        return;
      }

      const response = await prompts({
        type: "confirm",
        name: "generateClient",
        message: "Do you want to generate Prisma Client?",
        initial: true,
      });
      if (response?.generateClient === true) {
        try {
          await generateClient();
        } catch (e: any) {
          error(e);
        }
      } else {
        console.log("Prisma Client generation skipped.");
      }
    }

    async function promptInstallStudio() {
      if (options.autoSetupPrisma) {
        await installStudio();
        nuxt.hooks.hook("devtools:customTabs", (tab) => {
          tab.push({
            name: "nuxt-prisma",
            title: "Prisma Studio",
            icon: "simple-icons:prisma",
            category: "server",
            view: {
              type: "iframe",
              src: "http://localhost:5555/",
              persistent: true,
            },
          });
        });
        return;
      }

      const response = await prompts({
        type: "confirm",
        name: "installStudio",
        message:
          "Do you want to view and edit your data by installing Prisma Studio in Nuxt DevTools?",
        initial: true,
      });

      if (response?.installStudio === true) {
        try {
          await installStudio();
        } catch (e: any) {
          error(e);
        }
        // add Prisma Studio to Nuxt DevTools

        nuxt.hooks.hook("devtools:customTabs", (tab) => {
          tab.push({
            name: "nuxt-prisma",
            title: "Prisma Studio",
            icon: "simple-icons:prisma",
            category: "server",
            view: {
              type: "iframe",
              src: "http://localhost:5555/",
              persistent: true,
            },
          });
        });
      } else {
        console.log("Prisma Studio installation skipped.");
      }
    }

    async function writeClientPlugin() {
      const existingContent = fs.existsSync(resolveProject("lib", "prisma.ts"));
      try {
        if (!existingContent) {
          const prismaClient = `import { PrismaClient } from "@prisma/client"
const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
    `;
          if (!fs.existsSync("lib")) {
            fs.mkdirSync("lib");
          }
          fs.writeFileSync("lib/prisma.ts", prismaClient);
          success(
            "Global instance of Prisma Client successfully created within lib/prisma.ts file.",
          );
        }
      } catch (e: any) {
        error(e);
      }
    }

    async function setupPrismaORM() {
      console.log("Setting up Prisma ORM..");

      if (force_skip_prisma_setup) {
        error("Skipping Prisma ORM setup.");
        return;
      }

      if (!options.skipInstallations) {
        await promptCli();
        await promptInitPrisma();
        await promptRunMigration();
        await promptGenerateClient();
        await writeClientPlugin();
      }

      if (
        npm_lifecycle_event !== "dev:prepare" &&
        npm_lifecycle_event !== "postinstall" &&
        npm_lifecycle_event !== "test"
      ) {
        await promptInstallStudio();
      }
    }

    await setupPrismaORM();

    // Do not add the extension since the `.ts` will be transpiled to `.mjs` after `npm run prepack`
    addPlugin(resolver("./runtime/plugin"));
    addImportsDir(resolver(runtimeDir, "composables"));

    // Auto-import from runtime/server/utils
    addServerScanDir(
      createResolver(import.meta.url).resolve("./runtime/server"),
    );

    nuxt.options.vite.optimizeDeps ||= {};
    nuxt.options.vite.optimizeDeps = {
      include: ["@prisma/nuxt > @prisma/client"],
    };
  },
});
