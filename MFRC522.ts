/**
  * MFRC522 Block
  */
//% color="#275C6B" weight=100 icon="\uf2bb" block="MFRC522 RFID"
namespace MFRC522 {
    let Type2 = 0
    const BlockAdr: number[] = [4, 5, 6] // NTAG213 writable pages
    let TPrescalerReg = 0x2B
    let TxControlReg = 0x14
    let PICC_READ = 0x30
    let PICC_ANTICOLL = 0x93
    let PCD_RESETPHASE = 0x0F
    let temp = 0
    let val = 0
    let uid: number[] = []

    let returnLen = 0
    let returnData: number[] = []
    let status = 0
    let u = 0
    let ChkSerNum = 0
    let returnBits: any = null
    let recvData: number[] = []
    let PCD_IDLE = 0
    let d = 0

    let Status2Reg = 0x08
    let CommandReg = 0x01
    let BitFramingReg = 0x0D
    let MAX_LEN = 16
    let PCD_TRANSCEIVE = 0x0C
    let PICC_REQIDL = 0x26

    let ComIrqReg = 0x04
    let DivIrqReg = 0x05
    let FIFODataReg = 0x09
    let FIFOLevelReg = 0x0A
    let ControlReg = 0x0C

    function SetBits(reg: number, mask: number) {
        let tmp = SPI_Read(reg)
        SPI_Write(reg, tmp | mask)
    }

    function SPI_Write(adr: number, val: number) {
        pins.digitalWritePin(DigitalPin.P16, 0)
        pins.spiWrite((adr << 1) & 0x7E)
        pins.spiWrite(val)
        pins.digitalWritePin(DigitalPin.P16, 1)
    }

    function readFromCard(): string {
        let reqResult = Request(PICC_REQIDL)
        status = reqResult[0]
        Type2 = reqResult[1]
        if (status != 0) return ""

        let avoidResult = AvoidColl()
        status = avoidResult[0]
        uid = avoidResult[1]
        if (status != 0) return ""

        let text_read = ''
        let data: number[] = []

        for (let BlockNum of BlockAdr) {
            let block = ReadRFID(BlockNum)
            if (block != null) {
                data = data.concat(block as number[])
            }
        }

        for (let c of data) {
            text_read += String.fromCharCode(c)
        }

        return text_read.trim()
    }

    function SPI_Read(adr: number) {
        pins.digitalWritePin(DigitalPin.P16, 0)
        pins.spiWrite(((adr << 1) & 0x7E) | 0x80)
        val = pins.spiWrite(0)
        pins.digitalWritePin(DigitalPin.P16, 1)
        return val
    }

    function writeToCard(txt: string): number {
        let reqResult = Request(PICC_REQIDL)
        status = reqResult[0]
        Type2 = reqResult[1]
        if (status != 0) return null

        let avoidResult = AvoidColl()
        status = avoidResult[0]
        uid = avoidResult[1]
        if (status != 0) return null

        let data: number[] = []
        for (let i = 0; i < txt.length; i++) {
            data.push(txt.charCodeAt(i))
        }
        for (let j = txt.length; j < 48; j++) {
            data.push(32)
        }

        let b = 0
        for (let BlockNum of BlockAdr) {
            WriteRFID(BlockNum, data.slice(b * 16, (b + 1) * 16))
            b++
        }

        serial.writeLine("Written to Card")
        return getIDNum(uid)
    }

    function ReadRFID(blockAdr: number) {
        recvData = []
        recvData.push(PICC_READ)
        recvData.push(blockAdr)
        let pOut2 = CRC_Calculation(recvData)
        recvData.push(pOut2[0])
        recvData.push(pOut2[1])
        let result = MFRC522_ToCard(PCD_TRANSCEIVE, recvData)
        status = result[0]
        returnData = result[1]
        returnLen = result[2]

        if (status != 0) {
            serial.writeLine("Error while reading!")
        }

        if (returnData.length != 16) {
            return null
        } else {
            return returnData
        }
    }

    function ClearBits(reg: number, mask: number) {
        let tmp = SPI_Read(reg)
        SPI_Write(reg, tmp & (~mask))
    }

    function Request(reqMode: number): [number, number] {
        let Type: number[] = []
        SPI_Write(BitFramingReg, 0x07)
        Type.push(reqMode)
        let result = MFRC522_ToCard(PCD_TRANSCEIVE, Type)
        status = result[0]
        returnData = result[1]
        returnBits = result[2]

        if ((status != 0) || (returnBits != 16)) {
            status = 2
        }

        return [status, returnBits]
    }

    function AntennaON() {
        temp = SPI_Read(TxControlReg)
        if (~(temp & 0x03)) {
            SetBits(TxControlReg, 0x03)
        }
    }

    function AvoidColl(): [number, number[]] {
        let SerNum: number[] = []
        ChkSerNum = 0
        SPI_Write(BitFramingReg, 0)
        SerNum.push(PICC_ANTICOLL)
        SerNum.push(0x20)
        let result = MFRC522_ToCard(PCD_TRANSCEIVE, SerNum)
        status = result[0]
        returnData = result[1]

        if (status == 0) {
            if (returnData.length == 5) {
                for (let k = 0; k <= 3; k++) {
                    ChkSerNum = ChkSerNum ^ returnData[k]
                }
                if (ChkSerNum != returnData[4]) {
                    status = 2
                }
            } else {
                status = 2
            }
        }

        return [status, returnData]
    }

    function MFRC522_ToCard(command: number, sendData: number[]): [number, number[], number] {
        returnData = []
        returnLen = 0
        status = 2
        let irqEN = 0x00
        let waitIRQ = 0x00
        let lastBits = null
        let n = 0

        if (command == PCD_TRANSCEIVE) {
            irqEN = 0x77
            waitIRQ = 0x30
        }

        SPI_Write(0x02, irqEN | 0x80)
        ClearBits(ComIrqReg, 0x80)
        SetBits(FIFOLevelReg, 0x80)
        SPI_Write(CommandReg, PCD_IDLE)

        for (let o = 0; o < sendData.length; o++) {
            SPI_Write(FIFODataReg, sendData[o])
        }

        SPI_Write(CommandReg, command)

        if (command == PCD_TRANSCEIVE) {
            SetBits(BitFramingReg, 0x80)
        }

        let p = 2000
        while (true) {
            n = SPI_Read(ComIrqReg)
            p--
            if (~(p != 0 && ~(n & 0x01) && ~(n & waitIRQ))) {
                break
            }
        }

        ClearBits(BitFramingReg, 0x80)

        if (p != 0) {
            if ((SPI_Read(0x06) & 0x1B) == 0x00) {
                status = 0
                if (n & irqEN & 0x01) {
                    status = 1
                }

                if (command == PCD_TRANSCEIVE) {
                    n = SPI_Read(FIFOLevelReg)
                    lastBits = SPI_Read(ControlReg) & 0x07
                    if (lastBits != 0) {
                        returnLen = (n - 1) * 8 + lastBits
                    } else {
                        returnLen = n * 8
                    }
                    if (n == 0) {
                        n = 1
                    }
                    if (n > MAX_LEN) {
                        n = MAX_LEN
                    }
                    for (let q = 0; q < n; q++) {
                        returnData.push(SPI_Read(FIFODataReg))
                    }
                }
            } else {
                status = 2
            }
        }

        return [status, returnData, returnLen]
    }

    function CRC_Calculation(DataIn: number[]) {
        ClearBits(DivIrqReg, 0x04)
        SetBits(FIFOLevelReg, 0x80)
        for (let s = 0; s < DataIn.length; s++) {
            SPI_Write(FIFODataReg, DataIn[s])
        }
        SPI_Write(CommandReg, 0x03)
        let t = 0xFF

        while (true) {
            let v = SPI_Read(DivIrqReg)
            t--
            if (!(t != 0 && !(v & 0x04))) {
                break
            }
        }

        let DataOut: number[] = []
        DataOut.push(SPI_Read(0x22))
        DataOut.push(SPI_Read(0x21))
        return DataOut
    }

    function WriteRFID(blockAdr: number, writeData: number[]) {
        let buff: number[] = []
        let crc: number[] = []

        buff.push(0xA0)
        buff.push(blockAdr)
        crc = CRC_Calculation(buff)
        buff.push(crc[0])
        buff.push(crc[1])
        let result = MFRC522_ToCard(PCD_TRANSCEIVE, buff)
        status = result[0]
        returnData = result[1]
        returnLen = result[2]

        if ((status != 0) || (returnLen != 4) || ((returnData[0] & 0x0F) != 0x0A)) {
            status = 2
            serial.writeLine("ERROR")
        }

        if (status == 0) {
            let buff2: number[] = []
            for (let w = 0; w < 16; w++) {
                buff2.push(writeData[w])
            }
            crc = CRC_Calculation(buff2)
            buff2.push(crc[0])
            buff2.push(crc[1])
            let result2 = MFRC522_ToCard(PCD_TRANSCEIVE, buff2)
            status = result2[0]
            returnData = result2[1]
            returnLen = result2[2]

            if ((status != 0) || (returnLen != 4) || ((returnData[0] & 0x0F) != 0x0A)) {
                serial.writeLine("Error while writing")
            } else {
                serial.writeLine("Data written")
            }
        }
    }

    function getIDNum(uid: number[]) {
        let a = 0
        for (let e = 0; e < 5; e++) {
            a = a * 256 + uid[e]
        }
        return a
    }

    function readID() {
        let reqResult = Request(PICC_REQIDL)
        status = reqResult[0]
        if (status != 0) return null

        let avoidResult = AvoidColl()
        status = avoidResult[0]
        uid = avoidResult[1]
        if (status != 0) return null

        return getIDNum(uid)
    }

    //% block="Initialize MFRC522 Module"
    //% weight=100
    export function Init() {
        pins.spiPins(DigitalPin.P15, DigitalPin.P14, DigitalPin.P13)
        pins.spiFormat(8, 0)
        pins.digitalWritePin(DigitalPin.P16, 1)

        SPI_Write(CommandReg, PCD_RESETPHASE)
        SPI_Write(0x2A, 0x8D)
        SPI_Write(0x2B, 0x3E)
        SPI_Write(0x2D, 30)
        SPI_Write(0x2E, 0)
        SPI_Write(0x15, 0x40)
        SPI_Write(0x11, 0x3D)
        AntennaON()
    }

    //% block="Read ID"
    //% weight=95
    export function getID() {
        let id = readID()
        while (!id) {
            id = readID()
            if (id != undefined) return id
        }
        return id
    }

    //% block="Read data"
    //% weight=90
    export function read(): string {
        let text = readFromCard()
        while (!text) {
            text = readFromCard()
            if (text != '') return text
        }
        return text
    }

    //% block="Write Data %text"
    //% text
    //% weight=85
    export function write(text: string) {
        let id = writeToCard(text)
        while (!id) {
            id = writeToCard(text)
            if (id != undefined) return
        }
        return
    }

    //% block="Turn off antenna"
    //% text
    //% weight=80
    export function AntennaOff() {
        ClearBits(TxControlReg, 0x03)
    }
}
