#!/usr/bin/env node
// CLI falso: grava os argumentos recebidos em args.json no diretório de trabalho.
import fs from 'node:fs'
fs.writeFileSync('args.json', JSON.stringify(process.argv.slice(2)))
process.stdout.write('ok\n')
