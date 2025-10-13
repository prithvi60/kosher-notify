Update the tunnel url during dev in the following places
.env 1 place
shopify.app.toml 2 place
extension/blocks/notify_button.liquid 1 post request

admin panel.webhook settings

run local

ngrok app 300

use tunnel url after replacing

shopify app dev --tunnel-url=tunnelurl:300
