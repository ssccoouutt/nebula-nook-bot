from pathlib import Path

path = Path('/home/ubuntu/nebula-nook-bot/server/telegram.ts')
text = path.read_text()
old = next(line for line in text.splitlines() if 'return respond(chatId, `🟡 <b>Pay with Binance Pay</b>' in line)
new = '  return respond(chatId, formatBinancePayPurchasePrompt(product.name, safeQuantity, amountCents), undefined, messageId);'
text = text.replace(old, new, 1)
old_retry = next(line for line in text.splitlines() if 'Please send the correct Binance Pay transaction/order ID.' in line)
text = text.replace(old_retry, '    await respond(chatId, `❌ <b>Payment not verified</b>\\n\\n${reason}\\n\\nSend the correct transaction/order ID within the remaining payment window.`, undefined);', 1)
path.write_text(text)
