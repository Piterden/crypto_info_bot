require('dotenv').load()

// const knex = require('knex')
const https = require('https')
const Telegraf = require('telegraf')

const { session } = Telegraf
const {
  BOT_USERNAME, BOT_TOKEN, DB_CLIENT, DB_HOST, DB_DATABASE, DB_USERNAME,
  DB_PASSWORD, DB_CHARSET, COIN_API_KEY,
} = process.env

const PAGE_SIZE = 30

const options = {
  method: 'GET',
  hostname: 'rest.coinapi.io',
  headers: {
    'X-CoinAPI-Key': COIN_API_KEY,
  },
}

const bot = new Telegraf(BOT_TOKEN, {
  telegram: {
    webhookReply: false,
  },
  username: BOT_USERNAME,
})

/* bot.context.db = knex({
  client: DB_CLIENT,
  connection: {
    host: DB_HOST,
    user: DB_USERNAME,
    password: DB_PASSWORD,
    database: DB_DATABASE,
    charset: DB_CHARSET,
  },
}) */

bot.use(session())

let rates
let assets

const pagination = (ns, page) => ({
  reply_markup: {
    inline_keyboard: [[
      page !== 0
        ? { text: `< Prev ${PAGE_SIZE}`, callback_data: `/${ns}/prev` }
        : { text: '----------', callback_data: '/noop' },
      {
        text: `${page * PAGE_SIZE} - ${(page + 1) * PAGE_SIZE}`,
        callback_data: '/noop',
      },
      page !== (assets.length / PAGE_SIZE) - 1
        ? { text: `Next ${PAGE_SIZE} >`, callback_data: `/${ns}/next` }
        : { text: '----------', callback_data: '/noop' },
    ]],
  },
})

const getAssets = () => new Promise((resolve, reject) => {
  options.path = '/v1/assets'

  const req = https.request(options, (res) => {
    const chunks = []

    res.on('data', (chunk) => {
      chunks.push(chunk)
    })

    res.on('end', () => {
      try {
        assets = JSON.parse(chunks.join(''))
        resolve(assets)
      }
      catch (error) {
        console.log(error)
      }
    })
  })
  
  req.end()
})

const getRates = (name) => new Promise((resolve, reject) => {
  options.path = `/v1/exchangerate/${name}`

  const req = https.request(options, (res) => {
    const chunks = []

    res.on('data', (chunk) => {
      chunks.push(chunk)
    })

    res.on('end', () => {
      try {
        rates = JSON.parse(chunks.join(''))
        resolve(rates.rates)
      }
      catch (error) {
        console.log(error)
      }
    })
  })
  
  req.end()
})

bot.command('exchanges', async (ctx) => {
  options.path = '/v1/exchanges'

  const request = https.request(options, (response) => {
    const chunks = []

    response.on('data', (chunk) => {
      chunks.push(chunk)
    })

    response.on('end', () => {
      exchanges = JSON.parse(chunks.join(''))

      try {
        ctx.replyWithMarkdown(
          exchanges.map((item) => `*${item.exchange_id}* - [${item.name}](${item.website})`).join('\n'),
          { disable_web_page_preview: true }
        )
      }
      catch (error) {
        console.log(error)
      }
    })
  })

  request.end()  
})

bot.command('assets', async (ctx) => {
  let assets

  ctx.session.page = {
    ...ctx.session.page || {},
    assets: ctx.session.page && ctx.session.page.assets || 0,
  }

  try {
    assets = await getAssets()
  }
  catch (error) {
    console.log(error)
  }

  try {
    await ctx.replyWithMarkdown(
      `*Всего: ${assets.length}*.
--------------------------------------
` + assets
        .slice(ctx.session.page.assets * PAGE_SIZE, (ctx.session.page.assets + 1) * PAGE_SIZE)
        .map((item) => `*${item.asset_id}* - ${item.name} ${item.type_is_crypto ? '(crypto)' : ''}`)
        .join('\n'),
      {
        disable_web_page_preview: true,
        ...pagination('assets', ctx.session.page.assets),
      }
    )
  }
  catch (error) {
    console.log(error)
  }
})

bot.command('commands', async (ctx) => {
  let assets

  ctx.session.page = {
    ...ctx.session.page || {},
    commands: ctx.session.page && ctx.session.page.commands || 0,
  }

  try {
    assets = await getAssets()
  }
  catch (error) {
    console.log(error)
  }

  try {
    await ctx.replyWithMarkdown(
      `*Всего: ${assets.length}*.
--------------------------------------
` + assets
        .slice(ctx.session.page.commands * PAGE_SIZE, (ctx.session.page.commands + 1) * PAGE_SIZE)
        .map((item) => `/${item.asset_id.toLowerCase()} - *${item.name}*`)
        .join('\n'),
      {
        disable_web_page_preview: true,
        ...pagination('commands', ctx.session.page.commands),
      }
    )
  }
  catch (error) {
    console.log(error)
  }
})

const mapCommands = async () => {
  assets = await getAssets()

  assets.forEach((asset) => {
    const command = asset.asset_id.toLowerCase()
    
    bot.command(command, async (ctx) => {
      ctx.session.page = {
        ...ctx.session.page || {},
        [`rates-${command}`]: ctx.session.page && ctx.session.page[`rates-${command}`] || 0,
      }

      const data = await getRates(command)

      try {
        await ctx.replyWithMarkdown(
          data
            .slice(
              ctx.session.page[`rates-${command}`] * PAGE_SIZE,
              (ctx.session.page[`rates-${command}`] + 1) * PAGE_SIZE
            )
            .map((item) => `To *${item.asset_id_quote}*\n\`${item.rate}\``)
            .join('\n'),
          {
            disable_web_page_preview: true,
            ...pagination(`rates-${command}`, ctx.session.page[`rates-${command}`])
          }
        )
      }
      catch (error) {
        console.log(error)
      }
    })
  })
}

mapCommands()

bot.action(
  /^\/(commands|assets|rates-\w+)\/(\w+)$/,
  async (ctx) => {
    let assets

    try {
      assets = ctx.match[1].includes('rates-')
        ? await getRates(ctx.match[1].replace('rates-', ''))
        : await getAssets()
    }
    catch (error) {
      console.log(error)
    }

    switch (ctx.match[2]) {
      case 'prev': ctx.session.page[ctx.match[1]] > 0
        ? ctx.session.page[ctx.match[1]]--
        : 0
        break
      case 'next': ctx.session.page[ctx.match[1]] < (assets.length / PAGE_SIZE) - 1
        ? ctx.session.page[ctx.match[1]]++
        : (assets.length / PAGE_SIZE) - 1
        break
      default:
        break
    }
    
    await ctx.editMessageText(
      `*Всего: ${assets.length}*.
--------------------------------------
` + assets
        .slice(
          ctx.session.page[ctx.match[1]] * PAGE_SIZE,
          (ctx.session.page[ctx.match[1]] + 1) * PAGE_SIZE
        )
        .map((item) => {
          switch (ctx.match[1]) {
            case 'commands': return `/${item.asset_id.toLowerCase()} - *${item.name}*`
            case 'assets': return `*${item.asset_id}* - ${item.name} ${item.type_is_crypto ? '(crypto)' : ''}`
            default: return `To *${item.asset_id_quote}*\n\`${item.rate}\``
          }
        })
        .join('\n'),
      {
        disable_web_page_preview: true,
        parse_mode: 'Markdown',
        ...pagination(ctx.match[1], ctx.session.page[ctx.match[1]]),
      }
    )
    
    return ctx.answerCbQuery()
  }
)

bot.startPolling()
