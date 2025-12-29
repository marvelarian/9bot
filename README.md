# Grid Trading Bot Application

A comprehensive grid trading bot application built with Next.js, TypeScript, and Tailwind CSS. Integrated with Delta Exchange API for automated cryptocurrency trading.

## Features

### Core Grid Bot Logic
- ✅ **Buy when price crosses below grid level**
- ✅ **Sell when price crosses above grid level**
- ✅ **Level deactivation/reactivation** to prevent multiple entries during oscillations
- ✅ **Long/Short/Neutral trading modes** with proper position management

### Trading Parameters
- **Symbol**: Choose from BTCUSD, ETHUSD, BNBUSD, ADAUSD, SOLUSD
- **Lower & Upper Range**: Define the price range for grid levels
- **Number of Grids**: Set how many grid levels to create (2-50)
- **Mode**: Long, Short, or Neutral trading strategy
- **Quantity**: Base quantity per trade
- **Leverage**: Trading leverage (1x-100x)
- **Max Positions**: Maximum concurrent positions allowed
- **Consecutive Loss Limit**: Stop trading after specified losses

### Risk Management
- Circuit breaker system
- Daily loss limits
- Position size controls
- Maximum drawdown protection
- Real-time risk monitoring

### User Interface
- **Dashboard**: Monitor active bots and performance
- **Bot Creator**: Configure new grid bots with all parameters
- **Grid Status**: Visual grid level monitoring
- **Alert System**: Real-time notifications and alerts
- **Responsive Design**: Mobile-friendly interface

## Installation & Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Configuration**
   Create `.env.local` file:
   ```
   DELTA_API_KEY=your_api_key_here
   DELTA_API_SECRET=your_api_secret_here
   ```

3. **Run Development Server**
   ```bash
   npm run dev
   ```

4. **Open Application**
   Navigate to `http://localhost:3000`

## API Integration

The application integrates with Delta Exchange API for:
- Real-time price feeds
- Order placement and management
- Position tracking
- Account balance monitoring
- Historical data retrieval

## Grid Bot Logic

### Long Mode
- **Buy**: When price crosses below grid level (always allowed)
- **Sell**: When price crosses above grid level (requires prior buy position)

### Short Mode
- **Sell**: When price crosses above grid level (always allowed)
- **Buy**: When price crosses below grid level (requires prior sell position)

### Neutral Mode
- **Buy/Sell**: Based on crossing direction (both directions allowed)

### Level Management
- **Deactivation**: Level becomes inactive when crossed to prevent multiple entries
- **Reactivation**: All inactive levels reactivate when any other level is crossed
- **Prevention**: Stops price oscillation from triggering multiple orders at same level

## Project Structure

```
src/
├── app/                    # Next.js app router
│   ├── (dashboard)/       # Protected dashboard routes
│   ├── (auth)/            # Authentication routes
│   ├── globals.css        # Global styles
│   └── layout.tsx         # Root layout
├── components/            # Reusable UI components
│   ├── sidebar/          # Navigation sidebar
│   ├── ui/               # UI primitives
│   └── charts/           # Chart components
└── lib/                  # Business logic
    ├── grid-bot-engine.ts # Core grid bot logic
    ├── delta-api.ts      # Delta Exchange API client
    ├── risk-manager.ts   # Risk management system
    ├── alert-system.ts   # Alert/notification system
    └── types.ts          # TypeScript type definitions
```

## Risk Management Features

- **Circuit Breaker**: Emergency stop-loss for entire bot
- **Daily Loss Limits**: Prevent excessive daily losses
- **Position Limits**: Maximum concurrent positions
- **Consecutive Loss Protection**: Stop after series of losses
- **Position Sizing**: Percentage-based position sizing
- **Drawdown Control**: Maximum portfolio drawdown limits

## Alert System

- **Price Alerts**: Level crossing notifications
- **Position Alerts**: Order execution confirmations
- **Risk Alerts**: Risk limit breach warnings
- **System Alerts**: Bot status and error notifications
- **Browser Notifications**: Desktop push notifications

## Security Features

- API key validation
- Secure credential storage
- Rate limiting protection
- Error handling and logging
- Input validation and sanitization

## Future Enhancements

- [ ] WebSocket real-time price feeds
- [ ] Advanced charting and technical indicators
- [ ] Backtesting engine
- [ ] Multi-exchange support
- [ ] Social trading features
- [ ] Performance analytics dashboard
- [ ] Mobile application
- [ ] Subscription/payment system

## Disclaimer

This application is for educational and research purposes. Trading cryptocurrencies involves significant risk of loss. Always test with paper trading before using real funds. The developers are not responsible for any financial losses incurred through the use of this software.

## License

MIT License - see LICENSE file for details.

