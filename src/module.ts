import { defineNuxtModule, addPlugin, createResolver } from '@nuxt/kit'
import { Prisma } from '@prisma/client'
import { execa, type ExecaReturnValue} from 'execa'
import { addCustomTab } from '@nuxt/devtools-kit'
import defu from 'defu'
import fs from 'fs'
import prompts from 'prompts'
import chalk from 'chalk'

export interface ModuleOptions extends Prisma.PrismaClientOptions{
  /**
   * Database connection string to connect to your database.
   * @default process.env.DATABASE_URL //datasource url in your schema.prisma file	
   * @docs https://prisma.io/docs/reference/api-reference/prisma-client-reference#datasourceurl
   */
  datasourceUrl?: string

  /**
   * Determines the type and level of logging to the console.
   * @example ['query', 'info', 'warn', 'error']
   * @docs https://prisma.io/docs/reference/api-reference/prisma-client-reference#log
   */
  log?: (Prisma.LogLevel | Prisma.LogDefinition)[]

  /**
   * Determines the level of error formatting.
   * @default "colorless"
   * @docs https://prisma.io/docs/reference/api-reference/prisma-client-reference#errorformat
   */
  errorFormat?: Prisma.ErrorFormat
  installCli: boolean
  initPrisma: boolean
  writeToSchema: boolean
  formatSchema: boolean
  installClient: boolean
  generateClient: boolean
  installStudio: boolean
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-prisma',
    configKey: 'prisma'
  },
  // Default configuration options of the Nuxt module
  defaults: {
    datasourceUrl: process.env.DATABASE_URL,
    installCli: true,
    initPrisma: true,
    writeToSchema: true,
    formatSchema: true,
    installClient: true,
    generateClient: true,
    installStudio: true
  },
  async setup(options, nuxt) {    
    const { resolve: resolveProject } = createResolver(nuxt.options.rootDir)
    const { resolve: resolver } = createResolver(import.meta.url)
    
    // exposing module options to application runtime
    nuxt.options.runtimeConfig.public.prisma = defu(nuxt.options.runtimeConfig.public.prisma || {}, {
      log: options.log,
      errorFormat: options.errorFormat,
    })
    
    let prismaCliVersion: ExecaReturnValue | undefined

    function success(message: string) {
      console.log(chalk.green(`✔ ${message}`))
    }
    
    function error(message: string) {
      console.error(chalk.red(`✘ ${message}`))
    }

    async function detectCli() {
      try {
        prismaCliVersion = await execa('prisma', ['version'], { cwd: resolveProject() })
        success('Prisma CLI is installed.')
        return prismaCliVersion
      } catch (e) {
        error('Prisma CLI is not installed. Please install Prisma CLI.')
      }
    }

    async function installCli() {
      if (options.installCli){
        try {
          await execa('npm', ['install', 'prisma', '--save-dev'], {cwd: resolveProject()})
        } catch (e) {
          error('Failed to install Prisma CLI.')
        }
      }
    }

    async function initPrisma() {
      if (options.initPrisma){
        try {
          const { stdout: initializePrisma } = await execa('npx', ['prisma', 'init'], {cwd: resolveProject()})
          console.log(initializePrisma)
        } catch (e) {
          error('Failed to initialize Prisma project.')
        }
      }
    }

    async function writeToSchema() {
      if (options.writeToSchema) {
        try {
          const prismaSchemaPath = resolveProject('prisma', 'schema.prisma')
          let existingSchema = ''
          
          // read the existing content of the schema file
          try {
            existingSchema = fs.readFileSync(prismaSchemaPath, 'utf-8')
          } catch (e) {
            error('Error reading existing schema file')
          }
          
          const addModel = `
            model Post {
              id      Int      @id @default(autoincrement())
              title   String
              content String
              userId  Int
            }
          `
          const updatedSchema = `${existingSchema.trim()}\n\n${addModel}`
        
          try {
            fs.writeFileSync(prismaSchemaPath, updatedSchema)
          } catch (e) {
            error('Failed to write model to Prisma schema.')
          }
        } catch (e) {
          error('Failed to write model to Prisma schema.')
        }
      }
    }

    async function formatSchema() {
      if (options.formatSchema) {
        try {
          await execa('npx', ['prisma', 'format'], {cwd: resolveProject()})
        } catch (e) {
          error('Failed to format Prisma schema file.')
        }
      }
    }

    async function generateClient() {
      if (options.installClient && options.generateClient) {
        try {
          await execa('npm', ['install', '@prisma/client'], {cwd: resolveProject()})
          const { stdout: generateClient } = await execa('npx', ['prisma', 'generate'],{cwd: resolveProject()})
          console.log(generateClient)
        } catch (e) {
          error('Failed to generate Prisma Client.')
        }
      }
    }

    async function installStudio() {
      if (options.installStudio) {
        try {
          const { spawn } = require('child_process')
          await spawn('npx', ['prisma', 'studio', '--browser none'], {cwd: resolveProject()})
          success('Prisma Studio installed. You can view it as a tab in Nuxt DevTools.')        
        } catch (e) {
          error('Failed to install Prisma Studio.')
        }
      }
    }

    async function promptCli() {
      let prismaCliVersion = await detectCli()
      if (!prismaCliVersion) {
        const response = await prompts({
          type: 'confirm',
          name: 'installPrisma',
          message: 'Do you want to install Prisma CLI?',
          initial: true
        })

        if (response?.installPrisma === true) {
          await installCli()
          success('Prisma CLI successfully installed.')
        } else {
          console.log('Prisma CLI installation skipped.')
        }
      }
    }

    async function promptInitPrisma() {
      //check if prisma schema exists
      const schemaExists = fs.existsSync(resolveProject('prisma', 'schema.prisma'))
      if (schemaExists) {
        success('Prisma schema file exists.')
        console.log(`Please make sure to: \n 1. Set the DATABASE_URL in the .env file to point to your existing database. If your database has no tables yet, read https://pris.ly/d/getting-started 
        \n 2. Set the provider of the datasource block in schema.prisma to match your database: postgresql, mysql, sqlite, sqlserver, mongodb, or cockroachdb.
        \n 3. Run prisma db pull to turn your database schema into a Prisma schema.\n`)
      } else {
      console.log('Prisma schema file does not exist.')
      }

      if (schemaExists===false){
        const response = await prompts({
          type: 'confirm',
          name: 'initPrisma',
          message: 'Do you want to initialize Prisma?',
          initial: true
        })

        if (response?.initPrisma === true) {
          await initPrisma()
          await writeToSchema()
          await formatSchema()
        } else {
          console.log('Prisma initialization skipped.')
        }
      }
    }

    async function promptGenerateClient() {
      const response = await prompts({
        type: 'confirm',
        name: 'generateClient',
        message: 'Do you want to generate Prisma Client?',
        initial: true
      })
      if (response?.generateClient === true) {
        try {
          await generateClient()
        } catch (e: any) {
          error(e)
        }
      } else {
        console.log('Prisma Client generation skipped.')
      }
    }

    async function promptInstallStudio() {
      const response = await prompts({
        type: 'confirm',
        name: 'installStudio',
        message: 'Do you want to install Prisma Studio?',
        initial: true
      })

      if (response?.installStudio === true) {
        try {
          await installStudio()
        } catch (e: any) {
          error(e)
        }
        // add Prisma Studio to Nuxt DevTools
        addCustomTab({
          name: 'nuxt-prisma',
          title: 'Prisma Studio',
          icon: 'simple-icons:prisma',
          view: {
            type: 'iframe',
            src: 'http://localhost:5555/'
          }
        })
      } else {
        console.log('Prisma Studio installation skipped.')
      }
    }

    async function setupPrismaORM() {
      console.log('Setting up Prisma ORM..')
      await promptCli()
      await promptInitPrisma()
      await promptGenerateClient()
      await promptInstallStudio()
    }
    await setupPrismaORM()
    // Do not add the extension since the `.ts` will be transpiled to `.mjs` after `npm run prepack`
    addPlugin(resolver('./runtime/plugin'))
  }}
)
